"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Clock,
  ExternalLink,
  FileText,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  LoaderCircle,
  MessagesSquare,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import { useOperationalPolling } from "@/components/use-operational-polling";
import {
  Elapsed,
  LocalTime,
  formatCost,
  formatDuration,
  formatTokens,
  STAGE_ICONS,
  StageStatusDot,
  stageTone,
} from "@/components/coding/coding-ui";
import { api } from "@/lib/client-api";
import {
  PIPELINE_STAGES,
  RUN_STATUS_LABELS,
  SIDE_STAGES,
  STAGE_DEFINITIONS,
  STAGE_STATUS_LABELS,
  type CodingStage,
} from "@/lib/coding/stages";
import type { CodeFeedbackItem, CodeRunArtifact, CodeRunRepository } from "@/lib/coding/types";
import type { CodeDiff } from "@/lib/coding/code-runner";
import type { CodingRunDetail, CodeStageDetail } from "@/lib/coding/service";
import type { Message, RunDetailData, RunEvent } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

type ArtifactMeta = CodingRunDetail["artifacts"][number];

const APPROVE_LABELS: Partial<Record<CodingStage, string>> = {
  pm: "Approve spec",
  plan_review: "Continue anyway",
  engineer: "Continue anyway",
  code_review: "Publish & open draft PR",
  final_pass: "Mark as done",
};

function currentAttempt(stages: CodeStageDetail[], stage: CodingStage) {
  return stages
    .filter((item) => item.stage === stage && !item.superseded)
    .sort((a, b) => b.attempt - a.attempt)[0];
}

function latestAttempt(stages: CodeStageDetail[], stage: CodingStage) {
  return stages
    .filter((item) => item.stage === stage)
    .sort((a, b) => b.attempt - a.attempt || b.createdAt.localeCompare(a.createdAt))[0];
}

function artifactLabel(artifact: ArtifactMeta, all: ArtifactMeta[]) {
  const attempts = new Set(all.filter((item) => item.name === artifact.name).map((item) => item.attempt));
  if (attempts.size <= 1) return artifact.name;
  const dot = artifact.name.lastIndexOf(".");
  return `${artifact.name.slice(0, dot)}.attempt-${artifact.attempt}${artifact.name.slice(dot)}`;
}

function MarkdownOrCode({ name, content }: { name: string; content: string }) {
  if (name.endsWith(".json")) {
    let pretty = content;
    try {
      pretty = JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      // Show the raw content.
    }
    return <pre className="overflow-x-auto rounded-md bg-muted p-4 font-mono text-xs leading-5">{pretty}</pre>;
  }
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, "");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1];
  return (
    <div>
      {frontmatter && (
        <pre className="mb-4 overflow-x-auto rounded-md bg-muted px-4 py-2 font-mono text-xs leading-5 text-muted-foreground">
          {frontmatter}
        </pre>
      )}
      <article className="markdown">
        {/* Agent output may embed remote images (tracking beacons): render only their alt text. */}
        <ReactMarkdown remarkPlugins={[remarkGfm]} disallowedElements={["img"]} unwrapDisallowed>
          {body}
        </ReactMarkdown>
      </article>
    </div>
  );
}

function StageBox({
  stage,
  detail,
  selected,
  onSelect,
}: {
  stage: CodingStage;
  detail: CodeStageDetail | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = STAGE_ICONS[stage];
  const status = detail?.status ?? "pending";
  const usage = detail?.usage;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex min-w-28 flex-1 flex-col items-center gap-1 rounded-lg border border-transparent px-2 py-3 text-center transition hover:bg-muted/60",
        selected && "border-accent bg-accent-muted/50",
      )}
    >
      <span className={cn("relative grid size-9 place-items-center rounded-full border-2 bg-card", stageTone(status))}>
        <Icon className="size-4" />
        <StageStatusDot status={status} />
      </span>
      <span className="text-sm font-[650]">{STAGE_DEFINITIONS[stage].name}</span>
      <span className="font-mono text-[0.68rem] text-muted-foreground">
        {detail
          ? stage === "pr_feedback"
            ? `Round ${detail.attempt}`
            : `${formatDuration(usage?.durationMs)} · ${formatCost(usage?.costUsd)}`
          : "—"}
      </span>
      <span className="max-w-32 truncate text-[0.68rem] text-muted-foreground">
        {detail?.agentName ?? (stage === "publish" ? "Slab" : "")}
        {usage?.model && usage.model !== "default" ? ` · ${usage.model}` : ""}
      </span>
    </button>
  );
}

function Conversation({ runId, stage }: { runId: string; stage: CodeStageDetail }) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    const data = await api<{ messages: Message[] }>(
      `/api/coding/runs/${runId}/stages/${stage.id}/conversation`,
    );
    setMessages(data.messages);
  }, [runId, stage.id]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load().catch(() => setMessages([])), 0);
    return () => window.clearTimeout(timer);
  }, [load, stage.lastRunId, stage.status]);
  useOperationalPolling(load, stage.status === "running" ? 3_000 : 15_000);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages?.length]);
  if (!messages) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (!messages.length)
    return <p className="p-4 text-sm text-muted-foreground">No messages yet.</p>;
  return (
    <div className="grid max-h-[32rem] gap-3 overflow-y-auto p-4">
      {messages.map((message) => (
        <div
          key={message.id}
          className={cn(
            "rounded-lg border px-4 py-3 text-sm",
            message.role === "user" ? "bg-muted/60" : "bg-card",
          )}
        >
          <p className="mb-1 font-mono text-[0.66rem] uppercase tracking-wider text-muted-foreground">
            {message.role === "user" ? "Slab / you" : stage.agentName ?? "Agent"} · {formatDateTime(message.createdAt)}
          </p>
          <article className="markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.body}</ReactMarkdown>
          </article>
        </div>
      ))}
      {stage.status === "running" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" /> Working…
        </p>
      )}
      <div ref={bottom} />
    </div>
  );
}

function eventLabel(event: RunEvent) {
  const payload = event.payload;
  const tool = String(payload.tool ?? payload.name ?? payload.kind ?? "");
  const server = payload.server ? `${String(payload.server)} · ` : "";
  const command = typeof payload.command === "string" ? payload.command : "";
  if (event.type.startsWith("tool_")) return `${server}${tool}${command ? ` — ${command}` : ""}`;
  if (event.type === "approval_required") return `Approval required: ${String(payload.command ?? tool ?? "")}`;
  if (event.type === "run_failed") return `Failed: ${String(payload.error ?? payload.message ?? "")}`;
  return event.type.replaceAll("_", " ");
}

function Activity({ runId }: { runId: string | null }) {
  const [events, setEvents] = useState<RunEvent[] | null>(null);
  const load = useCallback(async () => {
    if (!runId) return;
    const data = await api<RunDetailData>(`/api/runs/${runId}`);
    setEvents(data.events);
  }, [runId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load().catch(() => setEvents([])), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useOperationalPolling(load, 5_000);
  if (!runId) return <p className="p-4 text-sm text-muted-foreground">This stage has not run yet.</p>;
  if (!events) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  const visible = events.filter((event) =>
    ["tool_started", "tool_failed", "approval_required", "approval_resolved", "run_started", "run_completed", "run_failed", "run_cancelled", "runtime_warning"].includes(event.type),
  );
  return (
    <div className="max-h-[32rem] overflow-y-auto p-2">
      {visible.length === 0 && <p className="p-2 text-sm text-muted-foreground">No activity yet.</p>}
      {visible.map((event) => (
        <div key={event.id} className="flex gap-3 border-b px-2 py-1.5 text-xs last:border-b-0">
          <span className="w-16 shrink-0 font-mono text-muted-foreground">
            <LocalTime value={event.createdAt} seconds />
          </span>
          <span className={cn("min-w-0 truncate", event.type === "tool_failed" || event.type === "run_failed" ? "text-destructive" : "")}>
            {eventLabel(event)}
          </span>
        </div>
      ))}
      <Link href={`/runs/${runId}`} className="mt-2 inline-flex items-center gap-1 px-2 text-xs text-muted-foreground hover:underline">
        Open the full run <ExternalLink className="size-3" />
      </Link>
    </div>
  );
}

function FeedbackPanel({
  runId,
  items,
  repositories,
  stage,
  actionable,
  onChanged,
}: {
  runId: string;
  items: CodeFeedbackItem[];
  repositories: CodeRunRepository[];
  stage: CodeStageDetail | undefined;
  actionable: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const locked = Boolean(busy) || !actionable || stage?.status === "running" || stage?.status === "queued";
  const step = (stage?.input as { feedbackStep?: string } | undefined)?.feedbackStep ?? "triage";
  async function call(label: string, url: string, init?: RequestInit) {
    setBusy(label);
    try {
      await api(url, { method: "POST", ...init });
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }
  async function decide(id: string, patch: Record<string, unknown>) {
    await call("decide", `/api/coding/runs/${runId}/feedback`, {
      method: "PATCH",
      body: JSON.stringify({ decisions: [{ id, ...patch }] }),
    });
  }
  const open = items.filter((item) => ["new", "triaged"].includes(item.status));
  const closed = items.filter((item) => !["new", "triaged"].includes(item.status));
  return (
    <div className="grid gap-4 p-4">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={locked} onClick={() => call("check", `/api/coding/runs/${runId}/feedback`)}>
          {busy === "check" ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          Check PR feedback
        </Button>
        {stage?.status === "waiting_approval" && step === "triage" && (
          <Button size="sm" disabled={locked} onClick={() => call("apply", `/api/coding/runs/${runId}/feedback/apply`)}>
            {busy === "apply" ? <LoaderCircle className="animate-spin" /> : <Check />}
            Apply decisions
          </Button>
        )}
        {stage?.status === "waiting_approval" && (
          <Button size="sm" variant={step === "apply" ? "default" : "outline"} disabled={locked} onClick={() => call("publish", `/api/coding/runs/${runId}/feedback/publish`)}>
            {busy === "publish" ? <LoaderCircle className="animate-spin" /> : <Upload />}
            {step === "apply" ? "Publish fixes & post replies" : "Post replies only"}
          </Button>
        )}
      </div>
      {stage && (
        <p className="text-sm text-muted-foreground">
          Round {stage.attempt} · {step === "apply" ? "Applying fixes" : "Triage"} · {STAGE_STATUS_LABELS[stage.status]}
          {stage.summary ? ` — ${stage.summary}` : ""}
        </p>
      )}
      {open.length === 0 && <p className="text-sm text-muted-foreground">No open feedback items.</p>}
      {open.map((item) => (
        <div key={item.id} className="grid gap-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {repositories.length > 1 && (
              <span className="rounded-full border px-1.5 font-mono">
                {repositories.find((entry) => entry.id === item.runRepositoryId)?.fullName ?? "?"}
              </span>
            )}
            <span className="font-[650] text-foreground">{item.author}</span>
            {item.authorIsBot && <StatusBadge status="draft" />}
            <span>{item.kind.replaceAll("_", " ")}</span>
            {item.path && <span className="font-mono">{item.path}{item.line ? `:${item.line}` : ""}</span>}
            {item.url && (
              <a href={item.url} target="_blank" rel="noreferrer" className="hover:underline">
                Open on GitHub
              </a>
            )}
            <StatusBadge status={item.status === "new" ? "queued" : "pending"} />
          </div>
          <p className="whitespace-pre-wrap text-sm">{item.body.slice(0, 1500)}</p>
          {item.status === "triaged" && (
            <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
              <Select disabled={locked} value={item.action ?? "no_action"} onValueChange={(value) => void decide(item.id, { action: value })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fix">Fix</SelectItem>
                  <SelectItem value="reply">Reply</SelectItem>
                  <SelectItem value="no_action">No action</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{item.reason}</p>
              {(item.action === "reply" || item.action === "fix") && (
                <Textarea
                  key={`${item.id}:${item.reply ?? ""}`}
                  disabled={locked}
                  className="sm:col-span-2 min-h-16 text-sm"
                  defaultValue={item.reply ?? ""}
                  placeholder="Reply to post on GitHub (optional for fixes)"
                  onBlur={(event) => {
                    if (event.target.value !== (item.reply ?? "")) void decide(item.id, { reply: event.target.value || null });
                  }}
                />
              )}
            </div>
          )}
          <div>
            <Button size="sm" variant="ghost" disabled={locked} onClick={() => void decide(item.id, { status: "dismissed" })}>
              Dismiss
            </Button>
          </div>
        </div>
      ))}
      {closed.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">{closed.length} decided item(s)</summary>
          <div className="mt-2 grid gap-1">
            {closed.map((item) => (
              <div key={item.id} className="flex items-center gap-2 text-xs">
                <StatusBadge status={item.status === "fixed" || item.status === "replied" ? "done" : "skipped"} />
                <span className="font-[650]">{item.author}</span>
                <span className="truncate text-muted-foreground">{item.body.slice(0, 120)}</span>
                {["dismissed", "no_action"].includes(item.status) && (
                  <Button size="sm" variant="ghost" className="h-6 px-2" disabled={locked} onClick={() => void decide(item.id, { status: "new" })}>
                    Reopen
                  </Button>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function DiffDialog({
  runId,
  repository,
  onOpenChange,
}: {
  runId: string;
  repository: CodeRunRepository | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [diff, setDiff] = useState<CodeDiff | null>(null);
  const [error, setError] = useState("");
  const open = Boolean(repository);
  const repositoryId = repository?.id ?? null;
  useEffect(() => {
    if (!repositoryId) return;
    const timer = window.setTimeout(() => {
      setDiff(null);
      setError("");
      api<CodeDiff>(`/api/coding/runs/${runId}/diff?repository=${encodeURIComponent(repositoryId)}`)
        .then(setDiff)
        .catch((reason: Error) => setError(reason.message));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [repositoryId, runId]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Files changed{repository ? <span className="font-mono text-muted-foreground"> · {repository.fullName}</span> : null}</DialogTitle>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!diff && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
        {diff && (
          <div className="min-h-0 overflow-y-auto">
            <p className="mb-2 text-sm">
              <span className="text-emerald-700">+{diff.insertions}</span>{" "}
              <span className="text-destructive">−{diff.deletions}</span> · {diff.files.length} files · {diff.commits.length} commits
              {diff.uncommitted && " · uncommitted changes"}
            </p>
            <div className="mb-3 grid gap-0.5">
              {diff.files.map((file) => (
                <div key={file.path} className="flex gap-3 font-mono text-xs">
                  <span className="w-4 text-muted-foreground">{file.status}</span>
                  <span className="text-emerald-700">+{file.insertions}</span>
                  <span className="text-destructive">−{file.deletions}</span>
                  <span>{file.path}</span>
                </div>
              ))}
            </div>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-[0.7rem] leading-5">
              {diff.patch.split("\n").map((line, index) => (
                <div
                  key={index}
                  className={cn(
                    line.startsWith("+") && !line.startsWith("+++") && "bg-emerald-500/10 text-emerald-800",
                    line.startsWith("-") && !line.startsWith("---") && "bg-destructive/10 text-destructive",
                    line.startsWith("@@") && "text-violet-700",
                  )}
                >
                  {line || " "}
                </div>
              ))}
            </pre>
            {diff.truncated && <p className="mt-2 text-xs text-muted-foreground">The patch was truncated.</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CodingRunDetailView({ initialData }: { initialData: CodingRunDetail }) {
  const [data, setData] = useState(initialData);
  const run = data.run;
  const [selected, setSelected] = useState<CodingStage>(run.currentStage);
  const [tab, setTab] = useState<"output" | "conversation" | "activity">("output");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [diffRepository, setDiffRepository] = useState<CodeRunRepository | null>(null);
  const [artifact, setArtifact] = useState<CodeRunArtifact | null>(null);
  const [stageOutput, setStageOutput] = useState<CodeRunArtifact | null>(null);
  const followCurrent = useRef(true);

  const refresh = useCallback(async () => {
    const next = await api<CodingRunDetail>(`/api/coding/runs/${initialData.run.id}`);
    setData(next);
    if (followCurrent.current) setSelected(next.run.currentStage);
  }, [initialData.run.id]);
  useOperationalPolling(refresh, 3_000);

  const stageDetail = currentAttempt(data.stages, selected) ?? latestAttempt(data.stages, selected);
  const outputName = selected === "final_pass" ? "final.md" : STAGE_DEFINITIONS[selected].output;
  const outputArtifact = useMemo(() => {
    if (!outputName) return null;
    const candidates = data.artifacts.filter(
      (item) =>
        item.name === outputName &&
        item.stage === selected &&
        (!stageDetail || item.attempt === stageDetail.attempt),
    );
    return candidates.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }, [data.artifacts, outputName, selected, stageDetail]);

  const shownOutput =
    stageOutput && outputArtifact && stageOutput.id === outputArtifact.id ? stageOutput : null;
  useEffect(() => {
    if (!outputArtifact || stageOutput?.id === outputArtifact.id) return;
    let active = true;
    api<CodeRunArtifact>(`/api/coding/runs/${run.id}/artifacts/${outputArtifact.id}`)
      .then((value) => active && setStageOutput(value))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [outputArtifact, run.id, stageOutput?.id]);
  const activeTab = selected === "chat" && tab === "output" ? "conversation" : tab;

  function select(stage: CodingStage) {
    followCurrent.current = stage === run.currentStage;
    setSelected(stage);
    if (stage !== "chat") setTab("output");
  }

  async function action(label: string, url: string, init: RequestInit = {}) {
    setBusy(label);
    try {
      await api(url, { method: "POST", ...init });
      await refresh();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Request failed");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function openArtifact(meta: ArtifactMeta) {
    try {
      setArtifact(await api<CodeRunArtifact>(`/api/coding/runs/${run.id}/artifacts/${meta.id}`));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open the file");
    }
  }

  async function sendMessage() {
    const text = message.trim();
    if (!text) return;
    const ok =
      selected === "chat"
        ? await action("send", `/api/coding/runs/${run.id}/chat`, { body: JSON.stringify({ message: text }) })
        : stageDetail
          ? await action("send", `/api/coding/runs/${run.id}/stages/${stageDetail.id}/reply`, {
              body: JSON.stringify({ message: text }),
            })
          : false;
    if (ok) {
      setMessage("");
      setTab("conversation");
    }
  }

  const open = ["preparing", "active", "waiting"].includes(run.status);
  const workspaceReady = run.workspaceStatus === "ready";
  const actionable = workspaceReady && run.status !== "cancelled";
  const hasPullRequest = run.repositories.some((item) => item.prNumber);
  const running = stageDetail && ["queued", "running"].includes(stageDetail.status);
  const canReply =
    workspaceReady &&
    run.status !== "cancelled" &&
    selected !== "publish" &&
    selected !== "pr_feedback" &&
    (selected === "chat" ? !running : Boolean(stageDetail) && !running && !stageDetail?.superseded);
  const artifactsByName = [...data.artifacts].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <div className="grid gap-5">
      <div>
        <Link href="/coding" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> All coding runs
        </Link>
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0">
            <h1 className="font-heading text-[clamp(1.6rem,2.6vw,2.2rem)] font-[675] leading-tight tracking-[-0.04em]">
              <span className="text-muted-foreground">#{run.number}</span> {run.issueKey} — {run.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <StatusBadge status={run.status === "active" ? "running" : run.status === "waiting" ? "waiting_approval" : run.status} />
              <span>{RUN_STATUS_LABELS[run.status]}</span>
              <Link href="/work" className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs hover:bg-muted">
                {run.issueKey}
              </Link>
              {run.repositories.map((item) => (
                <span key={item.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs">
                  <FolderGit2 className="size-3" /> {item.fullName}
                </span>
              ))}
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs">
                <GitBranch className="size-3" /> {run.branch}
              </span>
              {run.repositories.filter((item) => item.prUrl).map((item) => (
                <a key={item.id} href={item.prUrl!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs hover:bg-muted">
                  <GitPullRequest className="size-3" /> {run.repositories.length > 1 ? item.name : ""}#{item.prNumber}
                </a>
              ))}
              <span className="inline-flex items-center gap-1 text-xs">
                <Clock className="size-3" /> Started {formatDateTime(run.startedAt)}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-start gap-6">
            <div className="text-right">
              <p className="font-mono text-xl font-[650]">{formatCost(run.costUsd)}</p>
              <p className="font-mono text-[0.66rem] uppercase tracking-wider text-muted-foreground">Cost</p>
            </div>
            <div className="text-right">
              <p className="font-mono text-xl font-[650]"><Elapsed start={run.startedAt} end={run.finishedAt} /></p>
              <p className="font-mono text-[0.66rem] uppercase tracking-wider text-muted-foreground">Elapsed</p>
            </div>
            {open ? (
              <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => {
                if (window.confirm("Cancel this coding run? Running stages stop.")) void action("cancel", `/api/coding/runs/${run.id}`, { method: "DELETE" });
              }}>
                <XCircle /> Cancel run
              </Button>
            ) : run.workspaceStatus === "ready" ? (
              <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => {
                if (window.confirm("Delete the workspace? Local changes that were not published are lost.")) void action("workspace", `/api/coding/runs/${run.id}/workspace`, { method: "DELETE" });
              }}>
                <Trash2 /> Delete workspace
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {run.error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {run.error}
        </div>
      )}
      {["pending", "preparing"].includes(run.workspaceStatus) && run.status !== "failed" && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" /> Preparing the workspace: cloning {run.repositories.map((item) => item.fullName).join(", ")} and running the setup commands…
        </div>
      )}

      <section className="flex overflow-x-auto rounded-xl border bg-card p-2">
        {PIPELINE_STAGES.map((stage) => (
          <StageBox
            key={stage}
            stage={stage}
            detail={currentAttempt(data.stages, stage)}
            selected={selected === stage}
            onSelect={() => select(stage)}
          />
        ))}
        <span className="mx-1 w-px shrink-0 border-l border-dashed" />
        {SIDE_STAGES.map((stage) => (
          <StageBox
            key={stage}
            stage={stage}
            detail={latestAttempt(data.stages, stage)}
            selected={selected === stage}
            onSelect={() => select(stage)}
          />
        ))}
      </section>

      {workspaceReady && (
        <section className="grid gap-3 rounded-xl border bg-card p-4">
          {run.repositories.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-mono text-sm">
                  <GitPullRequest className="size-4" /> {item.fullName}{" "}
                  {item.prUrl ? (
                    <>
                      <span className="text-emerald-700">#{item.prNumber}</span>
                      {item.prState && <StatusBadge status={item.prState === "merged" ? "done" : item.prState} />}
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">no pull request yet</span>
                  )}
                </p>
                {item.prUrl && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    CI: {item.ciState ?? "unknown"} · branch {run.branch}
                    {item.publishedAt ? ` · last published ${formatDateTime(item.publishedAt)}` : ""}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {item.prUrl && (
                  <Button asChild size="sm">
                    <a href={item.prUrl} target="_blank" rel="noreferrer">
                      <ExternalLink /> Open PR
                    </a>
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setDiffRepository(item)}>
                  <FileText /> Files changed
                </Button>
              </div>
            </div>
          ))}
          {hasPullRequest && (
            <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
              <Button size="sm" variant="outline" disabled={!actionable || Boolean(busy)} onClick={() => void action("publish", `/api/coding/runs/${run.id}/publish`)}>
                {busy === "publish" ? <LoaderCircle className="animate-spin" /> : <Upload />} Publish changes
              </Button>
              <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => select("pr_feedback")}>
                <MessagesSquare /> PR feedback
              </Button>
            </div>
          )}
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_20rem]">
        <section className="min-w-0 rounded-xl border bg-card">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-[650]">{STAGE_DEFINITIONS[selected].title}</h2>
                {stageDetail && <StatusBadge status={stageDetail.status === "done" ? "done" : stageDetail.status === "needs_input" ? "waiting_approval" : stageDetail.status} />}
                {stageDetail && stageDetail.attempt > 1 && (
                  <span className="font-mono text-xs text-muted-foreground">attempt {stageDetail.attempt}</span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{STAGE_DEFINITIONS[selected].blurb}</p>
              {stageDetail?.summary && <p className="mt-2 text-sm">{stageDetail.summary}</p>}
              {stageDetail && stageDetail.pendingApprovals > 0 && stageDetail.lastRunId && (
                <Link href={`/runs/${stageDetail.lastRunId}`} className="mt-2 inline-flex items-center gap-1 text-sm text-amber-800 underline">
                  <AlertTriangle className="size-4" /> A tool call waits for your approval — open the run
                </Link>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {stageDetail?.status === "waiting_approval" && selected !== "pr_feedback" && (
                <Button size="sm" disabled={Boolean(busy) || !actionable} onClick={() => void action("approve", `/api/coding/runs/${run.id}/stages/${stageDetail.id}/approve`)}>
                  {busy === "approve" ? <LoaderCircle className="animate-spin" /> : <Check />}
                  {APPROVE_LABELS[selected] ?? "Approve"}
                </Button>
              )}
              {stageDetail && running && (
                <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void action("stop", `/api/coding/runs/${run.id}/stages/${stageDetail.id}/stop`)}>
                  <Square /> Stop
                </Button>
              )}
              {(PIPELINE_STAGES as readonly string[]).includes(selected) && workspaceReady && run.status !== "cancelled" && !running && (
                <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => {
                  if (window.confirm(`Re-run ${STAGE_DEFINITIONS[selected].name} and every later stage?`))
                    void action("rerun", `/api/coding/runs/${run.id}/rerun`, { body: JSON.stringify({ stage: selected }) });
                }}>
                  <RotateCcw /> Re-run from here
                </Button>
              )}
            </div>
          </div>

          {stageDetail && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 border-b px-4 py-2 font-mono text-xs text-muted-foreground">
              <span>Agent: {stageDetail.agentName ?? "—"}</span>
              <span>Model: {stageDetail.usage?.model ?? "default"}</span>
              <span>{formatDuration(stageDetail.usage?.durationMs)}</span>
              <span>{formatTokens(stageDetail.usage?.inputTokens ?? 0, stageDetail.usage?.outputTokens ?? 0)}</span>
              <span>{formatCost(stageDetail.usage?.costUsd)}</span>
            </div>
          )}

          {stageDetail?.status === "needs_input" && stageDetail.questions.length > 0 && (
            <div className="border-b bg-amber-500/5 p-4">
              <p className="mb-2 text-sm font-[650]">The agent needs your input</p>
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {stageDetail.questions.map((question, index) => (
                  <li key={index}>{question}</li>
                ))}
              </ol>
            </div>
          )}

          {selected === "pr_feedback" ? (
            hasPullRequest ? (
              <FeedbackPanel runId={run.id} items={data.feedback} repositories={run.repositories} stage={latestAttempt(data.stages, "pr_feedback")} actionable={actionable} onChanged={refresh} />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">PR feedback is available after Slab opens the pull request.</p>
            )
          ) : (
            <>
              <div className="flex gap-1 border-b px-4">
                {(selected === "chat" ? (["conversation", "activity"] as const) : (["output", "conversation", "activity"] as const)).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    className={cn(
                      "border-b-2 border-transparent px-3 py-2.5 text-sm capitalize text-muted-foreground",
                      activeTab === key && "border-accent font-[650] text-foreground",
                    )}
                  >
                    {key}
                  </button>
                ))}
              </div>
              {activeTab === "output" && (
                <div className="p-5">
                  {selected === "publish" ? (
                    <p className="text-sm text-muted-foreground">
                      {stageDetail?.summary ?? "Slab pushes the branch and opens a draft pull request after you approve the code review."}
                    </p>
                  ) : shownOutput ? (
                    <>
                      <p className="mb-4 font-mono text-xs text-muted-foreground">
                        handoff/{shownOutput.name} · updated {formatDateTime(shownOutput.createdAt)}
                      </p>
                      <MarkdownOrCode name={shownOutput.name} content={shownOutput.content} />
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">No output yet.</p>
                  )}
                </div>
              )}
              {activeTab === "conversation" &&
                (stageDetail ? (
                  <Conversation runId={run.id} stage={stageDetail} />
                ) : (
                  <p className="p-4 text-sm text-muted-foreground">
                    {selected === "chat" ? "Ask anything about this run, or request a change on the branch." : "This stage has not started."}
                  </p>
                ))}
              {activeTab === "activity" && (
                <Activity key={stageDetail?.lastRunId ?? "none"} runId={stageDetail?.lastRunId ?? null} />
              )}
            </>
          )}

          {canReply && (
            <div className="border-t p-4">
              <Textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void sendMessage();
                }}
                placeholder={
                  selected === "chat"
                    ? "Ask about the run or request a change on the branch…"
                    : stageDetail?.status === "needs_input"
                      ? "Answer the questions…"
                      : "Request changes. The stage continues in the same conversation and later stages restart."
                }
                className="min-h-20"
              />
              <div className="mt-2 flex justify-end">
                <Button size="sm" disabled={!message.trim() || Boolean(busy)} onClick={() => void sendMessage()}>
                  {busy === "send" ? <LoaderCircle className="animate-spin" /> : <Send />}
                  {selected === "chat" ? "Send" : stageDetail?.status === "needs_input" ? "Answer" : "Request changes"}
                </Button>
              </div>
            </div>
          )}
        </section>

        <aside className="rounded-xl border bg-card">
          <h2 className="flex items-center gap-2 border-b px-4 py-3 font-mono text-xs uppercase tracking-wider text-muted-foreground">
            <FileText className="size-4" /> Files
          </h2>
          <div className="grid p-2">
            {artifactsByName.length === 0 && <p className="p-2 text-sm text-muted-foreground">No files yet.</p>}
            {artifactsByName.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void openArtifact(item)}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left font-mono text-sm hover:bg-muted"
              >
                <span className="flex min-w-0 items-center gap-2 truncate">
                  <FileText className="size-4 shrink-0 text-muted-foreground" /> {artifactLabel(item, data.artifacts)}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  <LocalTime value={item.createdAt} />
                </span>
              </button>
            ))}
          </div>
          {data.repositories.map((repository) =>
            repository ? (
              <div key={repository.id} className="border-t p-4 text-xs text-muted-foreground">
                <p className="mb-1 font-mono uppercase tracking-wider">
                  {data.repositories.length > 1 ? repository.fullName : "Repository commands"}
                </p>
                <p>setup: {repository.setupCommand ?? "—"}</p>
                <p>test: {repository.testCommand ?? "—"}</p>
                <p>lint: {repository.lintCommand ?? "—"}</p>
              </div>
            ) : null,
          )}
        </aside>
      </div>

      <DiffDialog runId={run.id} repository={diffRepository} onOpenChange={(value) => !value && setDiffRepository(null)} />
      <Dialog open={Boolean(artifact)} onOpenChange={(value) => !value && setArtifact(null)}>
        <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-base">
              {artifact?.name} <span className="text-muted-foreground">· {artifact?.stage} · attempt {artifact?.attempt}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto">{artifact && <MarkdownOrCode name={artifact.name} content={artifact.content} />}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
