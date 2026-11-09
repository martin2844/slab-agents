import "server-only";

import { OperationalError } from "@/lib/operational-error";

/** Minimal Telegram Bot API client (https://core.telegram.org/bots/api). */

export type TelegramUser = { id: number; is_bot: boolean; first_name?: string; username?: string };
export type TelegramChat = { id: number; type: string; title?: string; username?: string; first_name?: string };
export type TelegramMessage = {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  reply_to_message?: TelegramMessage;
};
export type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
};
export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};
export type InlineButton = { text: string; callback_data: string } | { text: string; url: string };

export const TELEGRAM_TEXT_LIMIT = 4_000;

const API = "https://api.telegram.org";

export function telegramApiBase() {
  return (process.env.TELEGRAM_API_URL ?? API).replace(/\/$/, "");
}

export class TelegramApi {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  async call<T>(method: string, body: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${telegramApiBase()}/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new OperationalError("Telegram could not be reached.", "TELEGRAM_UNAVAILABLE", 502);
    }
    const payload = (await response.json().catch(() => null)) as
      | { ok: boolean; result?: T; description?: string; error_code?: number }
      | null;
    if (!response.ok || !payload?.ok) {
      throw new OperationalError(
        `Telegram returned an error: ${payload?.description ?? `HTTP ${response.status}`}`,
        response.status === 401 ? "TELEGRAM_AUTH_FAILED" : "TELEGRAM_API_ERROR",
        response.status === 401 ? 400 : 502,
      );
    }
    return payload.result as T;
  }

  getMe() {
    return this.call<TelegramUser>("getMe");
  }

  deleteWebhook() {
    return this.call<boolean>("deleteWebhook", { drop_pending_updates: false });
  }

  getUpdates(offset: number, timeoutSeconds = 25) {
    return this.call<TelegramUpdate[]>(
      "getUpdates",
      { offset, timeout: timeoutSeconds, allowed_updates: ["message", "callback_query"] },
      (timeoutSeconds + 10) * 1_000,
    );
  }

  sendMessage(input: { chatId: string; text: string; buttons?: InlineButton[][]; replyTo?: number | null }) {
    return this.call<TelegramMessage>("sendMessage", {
      chat_id: input.chatId,
      text: truncate(input.text),
      link_preview_options: { is_disabled: true },
      ...(input.replyTo ? { reply_parameters: { message_id: input.replyTo, allow_sending_without_reply: true } } : {}),
      ...(input.buttons?.length ? { reply_markup: { inline_keyboard: input.buttons } } : {}),
    });
  }

  editMessageText(input: { chatId: string; messageId: number; text: string; buttons?: InlineButton[][] }) {
    return this.call<TelegramMessage | boolean>("editMessageText", {
      chat_id: input.chatId,
      message_id: input.messageId,
      text: truncate(input.text),
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: input.buttons ?? [] },
    });
  }

  answerCallbackQuery(id: string, text?: string) {
    return this.call<boolean>("answerCallbackQuery", { callback_query_id: id, ...(text ? { text: text.slice(0, 190) } : {}) });
  }
}

export function truncate(text: string, limit = TELEGRAM_TEXT_LIMIT) {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
