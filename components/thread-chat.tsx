"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  Check,
  CornerDownLeft,
  LoaderCircle,
  ShieldAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client-api";
import { buildReplyDurations } from "@/lib/chat-metrics";
import { buildRunProgress } from "@/lib/run-progress";
import type {
  Approval,
  RunDetailData,
  RunEvent,
  RunStatus,
  ThreadData,
} from "@/lib/types";
type PendingApproval = { approvalId: string; command: string; runId?: string };

function liveEvent(type: string, payload: Record<string, unknown>): RunEvent {
  return {
    id: crypto.randomUUID(),
    runId: String(payload.runId ?? "live"),
    type,
    payload,
    createdAt: new Date().toISOString(),
  };
}

function runErrorMessage(error: string | null | undefined) {
  if (!error) return "The run failed";
  if (error.trim().toLowerCase() === "terminated") {
    return "Runner stopped before the agent could finish";
  }
  return error;
}

export function ThreadChat({
  threadId,
  initialData,
  initialRunId = null,
}: {
  threadId: string;
  initialData: ThreadData;
  initialRunId?: string | null;
}) {
  const [data, setData] = useState(initialData),
    [draft, setDraft] = useState(""),
    [streaming, setStreaming] = useState(false),
    [partial, setPartial] = useState(""),
    [approval, setApproval] = useState<PendingApproval | null>(null),
    [approvalResolving, setApprovalResolving] = useState(false),
    [backgroundRunId, setBackgroundRunId] = useState(initialRunId),
    [runEvents, setRunEvents] = useState<RunEvent[]>([]),
    [runStatus, setRunStatus] = useState<RunStatus | null>(
      initialRunId ? "running" : null,
    ),
    [runError, setRunError] = useState<string | null>(null),
    bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.messages, partial]);
  useEffect(() => {
    if (!backgroundRunId) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const [threadData, runData] = await Promise.all([
          api<ThreadData>(`/api/threads/${threadId}`),
          api<RunDetailData>(`/api/runs/${backgroundRunId}`),
        ]);
        if (cancelled) return;
        setData(threadData);
        setRunEvents(runData.events);
        setRunStatus(runData.run.status);
        const pending = runData.approvals.find(
          (item) => item.status === "pending",
        );
        setApproval(
          pending
            ? {
                approvalId: pending.id,
                command: pending.command,
                runId: pending.runId,
              }
            : null,
        );
        if (
          ["completed", "failed", "skipped", "cancelled"].includes(
            runData.run.status,
          )
        ) {
          setBackgroundRunId(null);
          if (runData.run.status === "failed") {
            const message = runErrorMessage(runData.run.error);
            setRunError(message);
            toast.error(message);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setBackgroundRunId(null);
          toast.error(
            error instanceof Error ? error.message : "Could not refresh run",
          );
        }
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [backgroundRunId, threadId]);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || !data || streaming) return;
    setDraft("");
    setStreaming(true);
    setPartial("");
    setApproval(null);
    setRunError(null);
    setRunStatus("running");
    setRunEvents([liveEvent("run_started", {})]);
    setData({
      ...data,
      messages: [
        ...data.messages,
        {
          id: crypto.randomUUID(),
          threadId,
          runId: null,
          role: "user",
          body: message,
          createdAt: new Date().toISOString(),
        },
      ],
    });
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, message }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? "Run failed");
      }
      const reader = response.body!.getReader(),
        decoder = new TextDecoder();
      let buffer = "",
        answer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const blocks = buffer.split(/\n\n/);
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const raw = block.replace(/^data:\s*/, "").trim();
          if (!raw) continue;
          const event = JSON.parse(raw);
          if (event.type === "assistant_delta") {
            answer += String(event.delta ?? "");
            setPartial(answer);
          } else if (event.type === "assistant_message") {
            answer = String(event.body ?? event.message ?? answer);
            setPartial(answer);
          } else if (event.type === "approval_required") {
            setRunStatus("waiting_approval");
            setApproval({
              approvalId: String(event.approvalId),
              command: String(
                event.command ?? event.description ?? "Runtime action",
              ),
              runId: event.runId,
            });
          } else if (event.type === "run_queued") {
            setRunEvents((current) => [
              ...current,
              liveEvent("run_queued", event),
            ]);
            setRunStatus("queued");
          } else if (
            event.type === "tool_started" ||
            event.type === "tool_completed" ||
            event.type === "tool_failed" ||
            event.type === "run_started"
          ) {
            setRunEvents((current) => [
              ...current,
              liveEvent(String(event.type), event),
            ]);
            setRunStatus("running");
          } else if (event.type === "run_completed") {
            setRunStatus("completed");
          } else if (event.type === "run_failed") {
            setRunStatus("failed");
            const message = runErrorMessage(String(event.error ?? ""));
            setRunError(message);
            throw new Error(message);
          }
        }
        if (done) break;
      }
      if (answer) {
        try {
          setData(await api<ThreadData>(`/api/threads/${threadId}`));
        } catch {
          setData((current) => ({
            ...current,
            messages: [
              ...current.messages,
              {
                id: crypto.randomUUID(),
                threadId,
                runId: null,
                role: "assistant",
                body: answer,
                createdAt: new Date().toISOString(),
              },
            ],
          }));
        }
      }
      setPartial("");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not reach Runner";
      setRunError(message);
      toast.error(message);
    } finally {
      setStreaming(false);
    }
  }
  async function decide(decision: "approve" | "deny") {
    if (!approval || approvalResolving) return;
    setApprovalResolving(true);
    try {
      const result = await api<Approval & { dismissed?: boolean }>(
        `/api/approvals/${approval.approvalId}`,
        {
          method: "POST",
          body: JSON.stringify({ decision }),
        },
      );
      if (result.dismissed) {
        toast.info("Stale approval dismissed");
        setApproval(null);
        setRunStatus("cancelled");
        setRunError("The Runner no longer has this run.");
        return;
      }
      toast.success(
        decision === "approve" ? "Action approved" : "Action denied",
      );
      setApproval(null);
      setRunStatus("running");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not resolve approval",
      );
    } finally {
      setApprovalResolving(false);
    }
  }
  const progress = buildRunProgress(
    runEvents,
    runStatus ?? (streaming || backgroundRunId ? "running" : null),
  );
  const replyDurations = useMemo(
    () => buildReplyDurations(data.messages),
    [data.messages],
  );
  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-4rem)] flex-col sm:-mx-6 sm:-my-8 lg:-my-10 xl:-mx-10">
      <header className="flex h-20 shrink-0 items-center gap-4 border-b bg-background px-4 sm:px-6 xl:px-10">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/agents/${data.agent.id}`} aria-label="Back to agent">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="grid size-10 place-items-center rounded-full bg-foreground font-heading text-lg text-background">
          {data.agent.name.slice(0, 1)}
        </div>
        <div>
          <h1 className="font-heading text-xl font-semibold">
            {data.thread.title}
          </h1>
          <p className="text-xs text-muted-foreground">
            {data.agent.name} · {data.agent.role}
          </p>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col px-4 py-8 sm:px-8">
          {!data.messages.length && !partial ? (
            <div className="my-auto py-16">
              <p className="text-xs font-bold uppercase tracking-[.18em] text-primary">
                New conversation
              </p>
              <h2 className="mt-3 max-w-xl font-heading text-4xl font-semibold leading-tight tracking-tight">
                What should {data.agent.name} move forward?
              </h2>
              <p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground">
                The agent can consult Work and Docs as needed. Give it a
                specific outcome, not a list of links.
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {data.messages.map((message) => (
                <article
                  key={message.id}
                  className={
                    message.role === "user"
                      ? "ml-auto max-w-[85%] border-l-2 border-primary bg-muted px-5 py-4"
                      : "max-w-full"
                  }
                >
                  <p className="mb-2 text-[0.65rem] font-bold uppercase tracking-[.16em] text-muted-foreground">
                    {message.role === "user" ? "You" : data.agent.name}
                  </p>
                  {message.role === "assistant" ? (
                    <>
                      <div className="markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.body}
                        </ReactMarkdown>
                      </div>
                      {replyDurations.has(message.id) && (
                        <p className="mt-3 text-[0.68rem] text-muted-foreground">
                          Replied in {replyDurations.get(message.id)}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-6">
                      {message.body}
                    </p>
                  )}
                </article>
              ))}
              {(partial || backgroundRunId || streaming) && (
                <article>
                  <p className="mb-2 text-[0.65rem] font-bold uppercase tracking-[.16em] text-muted-foreground">
                    {data.agent.name}
                  </p>
                  {partial && (
                    <div className="markdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {partial}
                      </ReactMarkdown>
                    </div>
                  )}
                  <div
                    className={
                      partial
                        ? "mt-4 border bg-muted/30 p-4"
                        : "border bg-muted/30 p-4"
                    }
                  >
                    <div className="flex items-center gap-2.5">
                      <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" />
                      <p className="text-sm font-semibold">
                        {progress.headline}
                      </p>
                    </div>
                    <p
                      className="mt-2 truncate font-mono text-[0.68rem] text-muted-foreground"
                      title={progress.command}
                    >
                      <span className="mr-1 text-primary">›</span>
                      {progress.command}
                    </p>
                    {progress.items.length > 0 && (
                      <ul className="mt-3 space-y-2 border-l pl-4">
                        {progress.items.map((item) => (
                          <li
                            key={item.id}
                            className="flex items-center gap-2 text-xs text-muted-foreground"
                          >
                            {item.status === "active" ? (
                              <LoaderCircle className="size-3.5 animate-spin text-primary" />
                            ) : item.status === "failed" ? (
                              <X className="size-3.5 text-destructive" />
                            ) : (
                              <Check className="size-3.5 text-emerald-700" />
                            )}
                            <span>{item.label}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-3 text-xs text-muted-foreground">
                      {progress.detail}
                    </p>
                  </div>
                </article>
              )}
              {approval && (
                <aside className="border border-amber-700/30 bg-amber-500/10 p-5">
                  <div className="flex gap-3">
                    <ShieldAlert className="mt-0.5 size-5 text-amber-800" />
                    <div className="min-w-0">
                      <p className="font-semibold">Approval required</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {data.agent.name} wants to execute:
                      </p>
                      <pre className="mt-3 overflow-auto bg-foreground p-3 font-mono text-xs text-background">
                        {approval.command}
                      </pre>
                      <div className="mt-4 flex gap-2">
                        <Button
                          size="sm"
                          disabled={approvalResolving}
                          onClick={() => decide("approve")}
                        >
                          {approvalResolving ? (
                            <LoaderCircle className="animate-spin" />
                          ) : (
                            <Check />
                          )}
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={approvalResolving}
                          onClick={() => decide("deny")}
                        >
                          <X />
                          Deny
                        </Button>
                      </div>
                    </div>
                  </div>
                </aside>
              )}
              {runError && (
                <aside
                  role="alert"
                  className="border border-destructive/30 bg-destructive/5 p-5"
                >
                  <div className="flex gap-3">
                    <ShieldAlert className="mt-0.5 size-5 text-destructive" />
                    <div>
                      <p className="font-semibold">Run stopped</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {runError}. You can send a new message below to retry.
                      </p>
                    </div>
                  </div>
                </aside>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </div>
      <footer className="shrink-0 border-t bg-background px-4 py-4 sm:px-6">
        <form
          onSubmit={send}
          className="mx-auto flex max-w-3xl items-end gap-3"
        >
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={`Message ${data.agent.name}…`}
            className="max-h-40 min-h-12 resize-none"
            disabled={streaming || Boolean(backgroundRunId)}
          />
          <Button
            type="submit"
            size="icon"
            className="size-12 shrink-0"
            disabled={!draft.trim() || streaming || Boolean(backgroundRunId)}
            aria-label="Send message"
          >
            {streaming ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <CornerDownLeft />
            )}
          </Button>
        </form>
        <p className="mx-auto mt-2 max-w-3xl text-[0.68rem] text-muted-foreground">
          Enter to send · Shift + Enter for a new line
        </p>
      </footer>
    </div>
  );
}
