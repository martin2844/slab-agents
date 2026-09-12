import "server-only";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { getRunCustomIntegrationRuntimeAccess } from "@/lib/integrations/service";
import {
  getWhatsAppSession,
  wahaRequest,
  whatsappSession,
} from "@/lib/integrations/whatsapp";
import { WHATSAPP_TOOLS } from "@/lib/integrations/catalog";

const chatId = z
  .string()
  .regex(/^\d[\d-]{4,49}@(c\.us|g\.us|lid)$/)
  .describe("Exact recipient/chat identifier, including @c.us or @g.us.");
const page = {
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).max(10000).default(0),
};
function result(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    ...(isError ? { isError: true } : {}),
  };
}
function pick(value: unknown, keys: string[]) {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    keys
      .filter((key) =>
        ["string", "number", "boolean"].includes(typeof record[key]),
      )
      .map((key) => [
        key,
        typeof record[key] === "string"
          ? record[key].slice(0, 12000)
          : record[key],
      ]),
  );
}

export async function handleWhatsAppMcpRequest(
  request: Request,
  integrationId: string,
  runId: string,
) {
  const token =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const access = () =>
    getRunCustomIntegrationRuntimeAccess(integrationId, runId, token);
  const initial = access();
  if (initial.status !== "ok" || initial.record.provider !== "whatsapp")
    return new Response("WhatsApp access unavailable", {
      status: initial.status === "stale" ? 409 : 401,
    });
  const account = initial.record.config.accountEmail;
  if (!account || !initial.record.enabled)
    return new Response("WhatsApp is disconnected", { status: 409 });
  const server = new McpServer({ name: "slab-whatsapp", version: "1.0.0" });
  const execute = async (tool: string, operation: () => Promise<unknown>) => {
    try {
      const current = access();
      if (
        current.status !== "ok" ||
        !current.record.enabled ||
        !current.allowedTools.includes(tool)
      )
        throw new Error("WhatsApp access changed. Start a new run.");
      const session = await getWhatsAppSession();
      if (session?.status !== "WORKING" || session.me?.id !== account)
        throw new Error(
          "WhatsApp account is disconnected or changed. Relink it before continuing.",
        );
      // Recheck after network I/O so revocation while checking the session wins.
      const latest = access();
      if (latest.status !== "ok" || !latest.allowedTools.includes(tool))
        throw new Error("WhatsApp access changed. Start a new run.");
      return result(await operation());
    } catch (error) {
      return result(
        {
          error:
            error instanceof Error ? error.message : "WhatsApp request failed",
        },
        true,
      );
    }
  };
  for (const tool of WHATSAPP_TOOLS.filter((item) =>
    initial.allowedTools.includes(item.key),
  )) {
    const metadata = {
      description: tool.description,
      annotations: {
        readOnlyHint: tool.readOnly,
        destructiveHint: false,
        idempotentHint: tool.readOnly,
        openWorldHint: true,
      },
    };
    if (tool.key === "whatsapp_list_chats")
      server.registerTool(
        tool.key,
        { ...metadata, inputSchema: page },
        (args) =>
          execute(tool.key, async () => {
            const rows = await wahaRequest(
              `/api/${whatsappSession}/chats?limit=${args.limit}&offset=${args.offset}`,
            );
            return {
              account,
              chats: Array.isArray(rows)
                ? rows
                    .slice(0, args.limit)
                    .map((row) =>
                      pick(row, ["id", "name", "unreadCount", "timestamp"]),
                    )
                : [],
            };
          }),
      );
    else if (tool.key === "whatsapp_get_messages")
      server.registerTool(
        tool.key,
        { ...metadata, inputSchema: { ...page, chatId } },
        (args) =>
          execute(tool.key, async () => {
            const rows = await wahaRequest(
              `/api/${whatsappSession}/chats/${encodeURIComponent(args.chatId)}/messages?limit=${args.limit}&offset=${args.offset}&downloadMedia=false`,
            );
            return {
              account,
              messages: Array.isArray(rows)
                ? rows
                    .slice(0, args.limit)
                    .map((row) =>
                      pick(row, [
                        "id",
                        "timestamp",
                        "from",
                        "fromMe",
                        "body",
                        "hasMedia",
                        "ack",
                      ]),
                    )
                : [],
            };
          }),
      );
    else
      server.registerTool(
        tool.key,
        {
          ...metadata,
          inputSchema: {
            account: z
              .literal(account)
              .describe("The exact WhatsApp sending account."),
            chatId,
            text: z.string().min(1).max(10000),
          },
        },
        (args) =>
          execute(tool.key, async () => {
            // No automatic retries: a timeout may mean that WhatsApp already sent it.
            return pick(
              await wahaRequest("/api/sendText", "POST", {
                session: whatsappSession,
                chatId: args.chatId,
                text: args.text,
                linkPreview: false,
              }),
              ["id", "timestamp", "from", "to", "ack"],
            );
          }),
      );
  }
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}
