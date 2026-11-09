"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CirclePause, Loader2, MessageCircle, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client-api";
import {
  whatsappPauseTitle,
  type WhatsAppChatStatus as ChatStatus,
} from "@/lib/whatsapp-chat-status";

export function WhatsAppChatStatus({ threadId }: { threadId: string }) {
  const [data, setData] = useState<ChatStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const mutating = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const version = revision.current;
      try {
        if (!mutating.current) {
          const next = await api<ChatStatus | null>(
            `/api/threads/${threadId}/whatsapp`,
            { signal: controller.signal },
          );
          if (!controller.signal.aborted && version === revision.current) {
            setData(next);
            setError("");
          }
        }
      } catch (reason) {
        if (!controller.signal.aborted && version === revision.current)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not refresh auto replies.",
          );
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 5000);
      }
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [threadId]);
  async function enable() {
    if (!data || mutating.current) return;
    mutating.current = true;
    revision.current++;
    setBusy(true);
    setError("");
    try {
      await api(
        `/api/automations/${data.automationId}/whatsapp/conversations`,
        {
          method: "PATCH",
          body: JSON.stringify({ chatId: data.chat.chatId, paused: false }),
        },
      );
      setData(
        await api<ChatStatus | null>(`/api/threads/${threadId}/whatsapp`),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not enable auto replies. Try again.",
      );
    } finally {
      mutating.current = false;
      setBusy(false);
    }
  }
  if (!data)
    return error ? (
      <p role="alert" className="mb-4 text-sm text-destructive">
        Could not load auto-reply status. {error}
      </p>
    ) : null;
  const { chat } = data;
  const unavailable = !data.enabled || !!data.blockedReason;
  const attention = chat.paused || unavailable || data.waitingApproval;
  return (
    <section
      aria-label="WhatsApp auto replies"
      className={`mb-4 flex flex-wrap items-start justify-between gap-4 rounded-lg border p-4 ${attention ? "border-amber-500/40 bg-amber-500/5" : "bg-card"}`}
    >
      <div className="min-w-0 flex-1 basis-72">
        <h2 className="flex items-start gap-2 text-sm font-semibold">
          {attention ? (
            <CirclePause className="mt-0.5 size-4 shrink-0" />
          ) : (
            <MessageCircle className="mt-0.5 size-4 shrink-0" />
          )}
          {chat.paused
            ? whatsappPauseTitle(chat.pauseReason)
            : unavailable
              ? "Auto replies are off"
              : data.waitingApproval
                ? "Reply waiting for your approval"
                : "Auto replies are on"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {chat.paused
            ? chat.pauseReason?.startsWith("You replied from WhatsApp.")
              ? "The agent stopped replying when you took over this chat."
              : chat.pauseReason ||
                "The agent will stay quiet in this chat until you enable auto replies again."
            : unavailable
              ? "This chat cannot receive automatic replies with the current settings."
              : data.waitingApproval
                ? "The agent prepared a reply. It needs your approval before sending it."
                : "The agent responds to new messages using your automation’s instructions and approval rules."}
        </p>
        {chat.paused && (
          <p className="mt-2 text-xs text-muted-foreground">
            Enabling auto replies starts with new messages. Messages received
            while paused will not be answered.
          </p>
        )}
        {unavailable && (
          <p className="mt-2 text-sm">
            {data.blockedReason ||
              "The automation is off. Activate it in automation settings first."}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {chat.paused && !unavailable && (
          <Button disabled={busy} onClick={() => void enable()}>
            {busy ? <Loader2 className="animate-spin" /> : <Play />}Enable auto
            replies again
          </Button>
        )}
        {data.waitingApproval && !chat.paused && (
          <Button variant="outline" asChild>
            <Link
              href={`/agents/${data.agentId}/threads/${threadId}?run=${chat.activeRunId || chat.lastRunId}`}
            >
              Review reply
            </Link>
          </Button>
        )}
        <Button variant="link" className="px-0" asChild>
          <Link href={`/automations/${data.automationId}#chat-replies`}>
            Automation settings
          </Link>
        </Button>
      </div>
    </section>
  );
}
