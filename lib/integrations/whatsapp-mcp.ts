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
import { whatsappAutomationRepository } from "@/lib/repositories/whatsapp-automation-repository";
import {
  assertWhatsAppSendApproved,
  markWhatsAppReplyForReview,
  whatsappApprovalServer,
  whatsappRunReplyConfig,
} from "@/lib/whatsapp-reply-policy";
import { filterToolsByRunPolicy } from "@/lib/agent-tool-policy";

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
  const review = new URL(request.url).searchParams.get("review") === "1";
  const token =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const access = () => {
    const current = getRunCustomIntegrationRuntimeAccess(
      integrationId,
      runId,
      token,
    );
    if (review && current.status === "ok")
      return {
        ...current,
        allowedTools: filterToolsByRunPolicy(
          runId,
          `whatsapp_review_${current.record.slug}`,
          current.allowedTools.filter((tool) => tool === "whatsapp_send_text"),
        ),
      };
    return current;
  };
  const initial = access();
  if (initial.status !== "ok" || initial.record.provider !== "whatsapp")
    return new Response("WhatsApp access unavailable", {
      status: initial.status === "stale" ? 409 : 401,
    });
  const account = initial.record.config.accountEmail;
  if (!account || !initial.record.enabled)
    return new Response("WhatsApp is disconnected", { status: 409 });
  const replyConfig = whatsappRunReplyConfig(runId);
  if (review && replyConfig?.replyApproval !== "conditional")
    return new Response("WhatsApp reply review is unavailable for this run", {
      status: 409,
    });
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
      if (review && tool === "whatsapp_send_text") {
        whatsappAutomationRepository.assertRun(runId, account);
        markWhatsAppReplyForReview(runId);
      }
      const session = await getWhatsAppSession();
      if (session?.status !== "WORKING" || session.me?.id !== account)
        throw new Error(
          "WhatsApp account is disconnected or changed. Relink it before continuing.",
        );
      // Recheck after network I/O so revocation while checking the session wins.
      const latest = access();
      if (latest.status !== "ok" || !latest.allowedTools.includes(tool))
        throw new Error("WhatsApp access changed. Start a new run.");
      whatsappAutomationRepository.assertRun(runId, account);
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
      description:
        tool.key === "whatsapp_send_text" &&
        replyConfig?.replyApproval === "conditional"
          ? review
            ? "Ask the owner to approve the exact WhatsApp reply before sending. Use for replies outside the automatic criteria, and whenever unsure."
            : "Send without approval only when the owner's automatic reply criteria clearly hold. Otherwise use whatsapp_send_text on the whatsapp_review_ server."
          : tool.description,
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
            const turn = whatsappAutomationRepository.assertRun(runId, account);
            if (turn)
              return {
                account,
                chats: args.offset ? [] : [{ id: turn.chat_id }],
              };
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
            whatsappAutomationRepository.assertRun(runId, account, args.chatId);
            const rows = await wahaRequest(
              `/api/${whatsappSession}/chats/${encodeURIComponent(args.chatId)}/messages?limit=${args.limit}&offset=${args.offset}&downloadMedia=false`,
              "GET",
              undefined,
              () => {
                whatsappAutomationRepository.assertRun(
                  runId,
                  account,
                  args.chatId,
                );
              },
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
            let managed = false;
            try {
              const sent = pick(
                await wahaRequest(
                  "/api/sendText",
                  "POST",
                  {
                    session: whatsappSession,
                    chatId: args.chatId,
                    text: args.text,
                    linkPreview: false,
                  },
                  () => {
                    const latest = access();
                    if (
                      latest.status !== "ok" ||
                      !latest.allowedTools.includes(tool.key)
                    )
                      throw new Error(
                        "WhatsApp access changed. Start a new run.",
                      );
                    const approvalServer = whatsappApprovalServer(
                      runId,
                      latest.record.slug,
                      review,
                    );
                    if (approvalServer)
                      assertWhatsAppSendApproved(runId, approvalServer, args);
                    managed = whatsappAutomationRepository.claimReply(
                      runId,
                      account,
                      args.chatId,
                      args.text,
                    );
                  },
                ),
                ["id", "timestamp", "from", "to", "ack"],
              );
              if (managed) {
                if (typeof sent.id !== "string" || !sent.id)
                  throw new Error(
                    "WhatsApp did not return a message identifier. Check the chat before resuming.",
                  );
                whatsappAutomationRepository.finishReply(runId, sent.id, true);
              }
              return sent;
            } catch (error) {
              if (managed)
                whatsappAutomationRepository.finishReply(runId, null, false);
              throw error;
            }
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
