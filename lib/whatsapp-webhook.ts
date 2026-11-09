import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { DomainError } from "@/lib/api";
import {
  whatsappWebhookKey,
  whatsappSession,
} from "@/lib/integrations/whatsapp";
import { whatsappDirectChatSchema } from "@/lib/whatsapp-automation";
import { whatsappAutomationRepository } from "@/lib/repositories/whatsapp-automation-repository";

const eventSchema = z.object({
  event: z.literal("message.any"),
  session: z.literal(whatsappSession),
  engine: z.string().max(30).optional(),
  me: z.object({ id: whatsappDirectChatSchema }),
  payload: z.object({
    id: z.string().min(1).max(300),
    from: z.string().max(150),
    to: z.string().max(150).nullish(),
    fromMe: z.boolean(),
    source: z.enum(["app", "api"]).optional(),
    timestamp: z.number().int().positive().max(10_000_000_000),
    body: z.string().max(100_000).nullish(),
    hasMedia: z.boolean().optional(),
  }),
});

export async function receiveWhatsAppWebhook(request: Request) {
  const signature = request.headers.get("x-webhook-hmac") ?? "";
  if (
    !/^[a-f\d]{128}$/i.test(signature) ||
    request.headers.get("x-webhook-hmac-algorithm") !== "sha512"
  )
    throw new DomainError(
      "INVALID_WEBHOOK_SIGNATURE",
      "Invalid webhook signature.",
      401,
    );
  const reader = request.body?.getReader();
  if (!reader)
    throw new DomainError("INVALID_WEBHOOK", "Missing webhook body.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 256_000)
        throw new DomainError(
          "WEBHOOK_TOO_LARGE",
          "Webhook body is too large.",
          413,
        );
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  const raw = Buffer.concat(chunks);
  const digest = createHmac("sha512", await whatsappWebhookKey())
    .update(raw)
    .digest();
  if (!timingSafeEqual(digest, Buffer.from(signature, "hex")))
    throw new DomainError(
      "INVALID_WEBHOOK_SIGNATURE",
      "Invalid webhook signature.",
      401,
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new DomainError("INVALID_WEBHOOK", "Invalid webhook body.", 400);
  }
  const event = eventSchema.safeParse(parsed);
  if (!event.success) return { accepted: false };
  const message = event.data.payload;
  // The pinned GOWS engine uses `from` as Info.Chat in both directions and
  // emits to:null for direct messages. Other engines use sender/recipient.
  const chatId =
    event.data.engine === "GOWS"
      ? message.from
      : message.fromMe
        ? message.to
        : message.from;
  if (!whatsappDirectChatSchema.safeParse(chatId).success)
    return { accepted: false };
  const text =
    message.body?.slice(0, 8000) ||
    (message.hasMedia
      ? "[Attachment received. Its contents are unavailable; ask for text if needed.]"
      : message.fromMe
        ? "[The account owner sent a non-text WhatsApp message.]"
        : "");
  if (!text) return { accepted: false };
  return {
    accepted: whatsappAutomationRepository.ingest({
      account: event.data.me.id,
      id: message.id,
      chatId: chatId!,
      text,
      timestampMs: message.timestamp * 1000,
      fromMe: message.fromMe,
      source: message.source ?? "app",
    }),
  };
}
