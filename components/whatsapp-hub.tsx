"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  CirclePause,
  ExternalLink,
  Loader2,
  MessageCircle,
  Play,
  RotateCcw,
  Search,
  Send,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client-api";
import { cn, formatDateTime, formatRelativePast } from "@/lib/utils";
import {
  ownerTookOver,
  type WhatsAppHubAttention,
  type WhatsAppHubConversation,
  type WhatsAppHubData,
  type WhatsAppHubMessage,
} from "@/lib/whatsapp-hub-types";

const attentionLabel: Record<WhatsAppHubAttention, string> = {
  approval: "Needs approval",
  failed: "Failed turn",
  uncertain: "Check delivery",
  paused: "Paused",
  pending: "Unanswered",
};

function displayName(chat: WhatsAppHubConversation) {
  if (chat.contactName) return chat.contactName;
  if (chat.phone) return chat.phone;
  return `Contact ${chat.chatId.split("@")[0]!.slice(-6)}`;
}

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

export function WhatsAppHub({
  initialData,
  initialChatId,
}: {
  initialData: WhatsAppHubData;
  initialChatId: string | null;
}) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [selected, setSelected] = useState<string | null>(
    initialChatId ?? initialData.conversations[0]?.chatId ?? null,
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "attention" | "archived">(
    "all",
  );
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setData(await api<WhatsAppHubData>("/api/whatsapp/hub"));
      setError("");
    } catch (reason) {
      setError(errorMessage(reason, "Could not refresh conversations."));
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  function select(chatId: string | null) {
    setSelected(chatId);
    router.replace(
      chatId ? `/whatsapp?chat=${encodeURIComponent(chatId)}` : "/whatsapp",
      { scroll: false },
    );
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.conversations.filter(
      (chat) =>
        (filter === "archived"
          ? chat.archived
          : !chat.archived && (filter === "all" || chat.attention)) &&
        (!needle ||
          displayName(chat).toLowerCase().includes(needle) ||
          chat.chatId.includes(needle) ||
          chat.phone?.includes(needle) ||
          chat.lastMessage?.body.toLowerCase().includes(needle)),
    );
  }, [data.conversations, filter, query]);
  const archivedCount = data.conversations.filter(
    (chat) => chat.archived,
  ).length;

  const current =
    data.conversations.find((chat) => chat.chatId === selected) ?? null;

  if (!data.enabled)
    return (
      <>
        <PageHeader title="WhatsApp" />
        <section className="rounded-lg border bg-card p-6 text-sm">
          <p className="font-semibold">WhatsApp is not enabled.</p>
          <p className="mt-1 text-muted-foreground">
            Connect and enable WhatsApp in Integrations to manage conversations
            here.
          </p>
          <Button className="mt-4" asChild>
            <Link href="/integrations">Open Integrations</Link>
          </Button>
        </section>
      </>
    );

  return (
    <>
      <PageHeader
        title="WhatsApp"
        description={`${data.conversations.length - archivedCount} chats · ${data.attentionCount} need attention${data.account ? ` · +${data.account.split("@")[0]}` : ""}`}
        actions={
          <Button variant="outline" asChild>
            <Link href="/automations">Automation settings</Link>
          </Button>
        }
      />
      {!data.connected && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
        >
          WhatsApp is disconnected. Replies cannot be sent until you reconnect
          it in Integrations.
        </p>
      )}
      {error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <section
          aria-label="Conversations"
          className={cn(
            "flex min-h-0 flex-col rounded-lg border bg-card lg:h-[calc(100dvh-11rem)]",
            current && "hidden lg:flex",
          )}
        >
          <div className="space-y-2 border-b p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search chats"
                aria-label="Search chats"
                className="pl-8"
              />
            </div>
            <div className="flex gap-1" role="group" aria-label="Filter">
              <Button
                size="sm"
                variant={filter === "all" ? "secondary" : "ghost"}
                onClick={() => setFilter("all")}
              >
                All
              </Button>
              <Button
                size="sm"
                variant={filter === "attention" ? "secondary" : "ghost"}
                onClick={() => setFilter("attention")}
              >
                Needs attention ({data.attentionCount})
              </Button>
              <Button
                size="sm"
                variant={filter === "archived" ? "secondary" : "ghost"}
                onClick={() => setFilter("archived")}
              >
                Archived ({archivedCount})
              </Button>
            </div>
          </div>
          <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
            {visible.map((chat) => (
              <li key={chat.chatId}>
                <button
                  type="button"
                  onClick={() => select(chat.chatId)}
                  aria-current={chat.chatId === selected}
                  className={cn(
                    "flex w-full flex-col gap-1 px-3 py-2.5 text-left hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
                    chat.chatId === selected && "bg-muted",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">
                      {displayName(chat)}
                    </span>
                    {chat.lastMessage && (
                      <time className="shrink-0 text-[0.7rem] text-muted-foreground">
                        {formatRelativePast(chat.lastMessage.at)}
                      </time>
                    )}
                  </span>
                  <span className="line-clamp-1 text-xs text-muted-foreground">
                    {chat.lastMessage
                      ? `${chat.lastMessage.fromMe ? "You: " : ""}${chat.lastMessage.body || "Media"}`
                      : "No messages yet"}
                  </span>
                  {(chat.attention ||
                    chat.activeRunId ||
                    (chat.paused && ownerTookOver(chat.pauseReason))) && (
                    <span className="flex flex-wrap gap-1">
                      {chat.attention && (
                        <Badge
                          variant={
                            chat.attention === "approval" ||
                            chat.attention === "failed"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {attentionLabel[chat.attention]}
                          {chat.attention === "pending"
                            ? ` · ${chat.pendingMessages}`
                            : ""}
                        </Badge>
                      )}
                      {chat.paused && ownerTookOver(chat.pauseReason) && (
                        <Badge variant="outline">You took over</Badge>
                      )}
                      {chat.activeRunId &&
                        chat.activeRunStatus !== "waiting_approval" && (
                          <Badge variant="outline">Agent replying…</Badge>
                        )}
                    </span>
                  )}
                </button>
              </li>
            ))}
            {!visible.length && (
              <li className="p-4 text-sm text-muted-foreground">
                {filter === "archived" && !query.trim()
                  ? "No archived chats. Archived chats come back when the customer writes again."
                  : data.conversations.length
                  ? "No chats match."
                  : "No conversations yet. Chats appear here when someone messages your automated WhatsApp."}
              </li>
            )}
          </ul>
        </section>
        {current ? (
          <ConversationPane
            key={current.chatId}
            chat={current}
            connected={data.connected}
            onBack={() => select(null)}
            onChanged={refresh}
          />
        ) : (
          <section className="hidden items-center justify-center rounded-lg border bg-card p-6 text-sm text-muted-foreground lg:flex">
            Select a chat to see the conversation.
          </section>
        )}
      </div>
    </>
  );
}

function ConversationPane({
  chat,
  connected,
  onBack,
  onChanged,
}: {
  chat: WhatsAppHubConversation;
  connected: boolean;
  onBack: () => void;
  onChanged: () => Promise<void>;
}) {
  const [messages, setMessages] = useState<WhatsAppHubMessage[] | null>(null);
  const [historySource, setHistorySource] = useState<"whatsapp" | "stored">(
    "whatsapp",
  );
  const [text, setText] = useState("");
  const [keepAutoReplies, setKeepAutoReplies] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  const loadMessages = useCallback(async () => {
    try {
      const result = await api<{
        messages: WhatsAppHubMessage[];
        source: "whatsapp" | "stored";
      }>(`/api/whatsapp/hub/${encodeURIComponent(chat.chatId)}/messages`);
      setMessages(result.messages);
      setHistorySource(result.source);
    } catch (reason) {
      setError(errorMessage(reason, "Could not load messages."));
    }
  }, [chat.chatId]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await api<{
          messages: WhatsAppHubMessage[];
          source: "whatsapp" | "stored";
        }>(`/api/whatsapp/hub/${encodeURIComponent(chat.chatId)}/messages`, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setMessages(result.messages);
          setHistorySource(result.source);
        }
      } catch (reason) {
        if (!controller.signal.aborted)
          setError(errorMessage(reason, "Could not load messages."));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [chat.chatId]);

  useEffect(() => {
    if (messages && messages.length !== lastCount.current) {
      lastCount.current = messages.length;
      bottom.current?.scrollIntoView({ block: "end" });
    }
  }, [messages]);

  async function act(name: string, operation: () => Promise<unknown>) {
    setBusy(name);
    setError("");
    try {
      await operation();
      await Promise.all([onChanged(), loadMessages()]);
      return true;
    } catch (reason) {
      setError(errorMessage(reason, "The action failed. Try again."));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const setArchived = (archived: boolean) =>
    act(archived ? "archive" : "unarchive", () =>
      api(`/api/whatsapp/hub/${encodeURIComponent(chat.chatId)}/archive`, {
        method: archived ? "POST" : "DELETE",
      }),
    );

  const setPaused = (paused: boolean) =>
    act(paused ? "pause" : "resume", () =>
      api(`/api/automations/${chat.automationId}/whatsapp/conversations`, {
        method: "PATCH",
        body: JSON.stringify({ chatId: chat.chatId, paused }),
      }),
    );

  async function send() {
    const body = text.trim();
    if (!body) return;
    const sent = await act("send", () =>
      api(`/api/whatsapp/hub/${encodeURIComponent(chat.chatId)}/reply`, {
        method: "POST",
        body: JSON.stringify({ text: body, keepAutoReplies }),
      }),
    );
    if (sent) setText("");
  }

  const retry = chat.failedRun?.retry;

  return (
    <section
      aria-label={`Conversation with ${displayName(chat)}`}
      className="flex min-h-[32rem] min-w-0 flex-col rounded-lg border bg-card lg:h-[calc(100dvh-11rem)]"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b p-3">
        <div className="flex min-w-0 items-start gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Back to chats"
            onClick={onBack}
          >
            <ArrowLeft />
          </Button>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">
              {displayName(chat)}
            </h2>
            <p className="truncate font-mono text-[0.7rem] text-muted-foreground">
              {chat.contactName && chat.phone ? `${chat.phone} · ` : ""}
              {chat.agentName} · {chat.automationName}
              {!chat.automationEnabled && " (automation off)"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {chat.threadId && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/agents/${chat.agentId}/threads/${chat.threadId}`}>
                <MessageCircle /> Agent chat
              </Link>
            </Button>
          )}
          {(chat.activeRunId || chat.lastRunId) && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/runs/${chat.activeRunId || chat.lastRunId}`}>
                <ExternalLink /> {chat.activeRunId ? "Current run" : "Last run"}
              </Link>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={!!busy || (!chat.archived && !!chat.approval)}
            title={
              chat.archived
                ? "Show this chat in the main list again"
                : "Hide this chat until the customer writes again"
            }
            onClick={() => void setArchived(!chat.archived)}
          >
            {busy === "archive" || busy === "unarchive" ? (
              <Loader2 className="animate-spin" />
            ) : chat.archived ? (
              <ArchiveRestore />
            ) : (
              <Archive />
            )}
            {chat.archived ? "Unarchive" : "Archive"}
          </Button>
          {chat.paused ? (
            <Button
              size="sm"
              disabled={!!busy || !chat.automationEnabled}
              onClick={() => void setPaused(false)}
            >
              {busy === "resume" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Play />
              )}
              Resume auto replies
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={!!busy}
              onClick={() => void setPaused(true)}
            >
              {busy === "pause" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <CirclePause />
              )}
              Pause auto replies
            </Button>
          )}
        </div>
      </header>

      {chat.approval && (
        <div className="space-y-2 border-b border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-sm font-semibold">Reply waiting for your approval</p>
          <p className="whitespace-pre-wrap rounded-md border bg-background p-2 text-sm">
            {chat.approval.text || "The draft text is unavailable."}
          </p>
          {chat.approval.fallbackAt && (
            <p className="text-xs text-muted-foreground">
              Sends automatically on {formatDateTime(chat.approval.fallbackAt)}{" "}
              if you do not act.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!!busy || !connected}
              onClick={() =>
                void act("approve", () =>
                  api(`/api/approvals/${chat.approval!.id}`, {
                    method: "POST",
                    body: JSON.stringify({ decision: "approve" }),
                  }),
                )
              }
            >
              {busy === "approve" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Check />
              )}
              Approve and send
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy}
              onClick={() =>
                void act("deny", () =>
                  api(`/api/approvals/${chat.approval!.id}`, {
                    method: "POST",
                    body: JSON.stringify({ decision: "deny" }),
                  }),
                )
              }
            >
              {busy === "deny" ? <Loader2 className="animate-spin" /> : <X />}
              Deny
            </Button>
          </div>
        </div>
      )}

      {chat.paused && (
        <p className="border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {chat.pauseReason ?? "Auto replies are paused for this chat."}
        </p>
      )}

      {retry && retry.status !== "retried" && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
          <span className="text-destructive">
            The last agent turn failed.
            {retry.status === "unavailable" && (
              <span className="ml-1 text-muted-foreground">
                Retry unavailable: {retry.reason}
              </span>
            )}
          </span>
          {retry.status === "available" && (
            <Button
              size="sm"
              disabled={!!busy}
              onClick={() =>
                void act("retry", () =>
                  api(`/api/runs/${chat.failedRun!.runId}/retry`, {
                    method: "POST",
                  }),
                )
              }
            >
              {busy === "retry" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RotateCcw />
              )}
              Retry run
            </Button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {historySource === "stored" && (
          <p className="text-center text-xs text-muted-foreground">
            WhatsApp history is unavailable. Showing messages stored by Slab.
          </p>
        )}
        {messages === null ? (
          <p className="text-sm text-muted-foreground">Loading messages…</p>
        ) : messages.length ? (
          messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                message.fromMe
                  ? "ml-auto bg-primary text-primary-foreground"
                  : "bg-muted",
              )}
            >
              <p className="whitespace-pre-wrap break-words">
                {message.body || (message.hasMedia ? "Media message" : "")}
              </p>
              <time
                className={cn(
                  "mt-1 block text-[0.65rem]",
                  message.fromMe
                    ? "text-primary-foreground/70"
                    : "text-muted-foreground",
                )}
              >
                {formatDateTime(message.timestamp)}
              </time>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No messages yet.</p>
        )}
        <div ref={bottom} />
      </div>

      <form
        className="space-y-2 border-t p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void send();
            }
          }}
          rows={2}
          maxLength={4000}
          placeholder={
            connected ? "Reply manually…" : "Reconnect WhatsApp to reply"
          }
          aria-label="Manual reply"
          disabled={!connected}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={keepAutoReplies}
              onChange={(event) => setKeepAutoReplies(event.target.checked)}
            />
            Keep auto replies on after my reply
          </label>
          <Button
            type="submit"
            size="sm"
            disabled={!connected || !text.trim() || !!busy}
          >
            {busy === "send" ? <Loader2 className="animate-spin" /> : <Send />}
            Send
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
