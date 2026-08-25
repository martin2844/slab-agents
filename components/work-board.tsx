"use client";
/* eslint-disable react-hooks/set-state-in-effect -- remote board selection intentionally resets loading state */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bug,
  Bot,
  Check,
  CircleDot,
  ExternalLink,
  LoaderCircle,
  MessageSquare,
  Pencil,
  PlugZap,
  Plus,
  RefreshCw,
  User,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { api, ApiClientError } from "@/lib/client-api";
import { formatDateTime } from "@/lib/utils";
import type {
  Agent,
  Comment,
  Issue,
  IssuePriority,
  IssueStatus,
  Project,
  SetupStatus,
  WorkPageData,
} from "@/lib/types";

const columns: { key: IssueStatus; label: string; caption: string }[] = [
  { key: "new", label: "New", caption: "Ready to be picked up" },
  { key: "in_progress", label: "In progress", caption: "Actively moving" },
  { key: "blocked", label: "Blocked", caption: "Waiting on a dependency" },
  { key: "review", label: "Review", caption: "Needs a decision" },
  { key: "done", label: "Done", caption: "Closed work" },
];
const priorityTone: Record<IssuePriority, string> = {
  critical: "bg-red-700 text-white",
  high: "bg-orange-200 text-orange-900",
  medium: "bg-stone-200 text-stone-800",
  low: "bg-stone-100 text-stone-600",
};
type Detail = {
  issue: Issue;
  comments: Comment[];
  links: Record<string, unknown>;
};
type IssueDraft = {
  title: string;
  assignee: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
};

function draftFromIssue(issue: Issue): IssueDraft {
  return {
    title: issue.title,
    assignee: issue.assignee ?? "",
    description: issue.description ?? "",
    status: issue.status,
    priority: issue.priority,
  };
}

function CreateIssue({
  projectKey,
  agents,
  onCreated,
}: {
  projectKey: string;
  agents: Agent[];
  onCreated: (issue: Issue) => void;
}) {
  const [open, setOpen] = useState(false),
    [saving, setSaving] = useState(false),
    [priority, setPriority] = useState<IssuePriority>("medium"),
    [type, setType] = useState<Issue["type"]>("task");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const form = new FormData(e.currentTarget);
    try {
      const issue = await api<Issue>("/api/work/issues", {
        method: "POST",
        body: JSON.stringify({
          project_key: projectKey,
          title: form.get("title"),
          description: form.get("description"),
          assignee: form.get("assignee") || undefined,
          priority,
          type,
          labels: [],
        }),
      });
      onCreated(issue);
      setOpen(false);
      toast.success(`${issue.key} created`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not create issue",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={!projectKey}>
          <Plus />
          New issue
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="font-heading text-3xl">
              Add work
            </DialogTitle>
          </DialogHeader>
          <div className="mt-6 grid gap-5">
            <label className="grid gap-2 text-sm font-semibold">
              Title
              <Input
                name="title"
                placeholder="A clear, actionable outcome"
                required
                autoFocus
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Description
              <Textarea
                name="description"
                placeholder="Context and acceptance criteria…"
                className="min-h-32"
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold">
                Type
                <Select
                  value={type}
                  onValueChange={(v) => setType(v as Issue["type"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["task", "story", "bug", "epic"].map((v) => (
                      <SelectItem value={v} key={v} className="capitalize">
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                Priority
                <Select
                  value={priority}
                  onValueChange={(v) => setPriority(v as IssuePriority)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["critical", "high", "medium", "low"].map((v) => (
                      <SelectItem value={v} key={v} className="capitalize">
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
            <label className="grid gap-2 text-sm font-semibold">
              Assignee
              <Input name="assignee" placeholder="Person or agent" />
              {agents.length > 0 && (
                <span className="flex flex-wrap gap-1.5">
                  {agents.map((agent) => (
                    <Button
                      key={agent.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs font-normal"
                      onClick={(event) => {
                        const form = event.currentTarget.closest("form");
                        const input = form?.elements.namedItem("assignee");
                        if (input instanceof HTMLInputElement)
                          input.value = agent.slug;
                      }}
                    >
                      {agent.name} · {agent.slug}
                    </Button>
                  ))}
                </span>
              )}
            </label>
          </div>
          <DialogFooter className="mt-6">
            <Button type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create issue"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function IssueDialog({
  issueKey,
  agents,
  onClose,
  onUpdated,
}: {
  issueKey: string | null;
  agents: Agent[];
  onClose: () => void;
  onUpdated: (issue: Issue) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null),
    [draft, setDraft] = useState<IssueDraft | null>(null),
    [editing, setEditing] = useState(false),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!issueKey) {
      setDetail(null);
      setDraft(null);
      setEditing(false);
      return;
    }
    let active = true;
    setError("");
    api<Detail>(`/api/work/issues/${issueKey}`)
      .then((next) => {
        if (!active) return;
        setDetail(next);
        setDraft(draftFromIssue(next.issue));
        setEditing(false);
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [issueKey]);

  function startEditing() {
    if (!detail) return;
    setDraft(draftFromIssue(detail.issue));
    setEditing(true);
  }

  function cancelEditing() {
    if (detail) setDraft(draftFromIssue(detail.issue));
    setEditing(false);
  }

  async function saveIssue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!issueKey || !draft || !detail) return;
    setSaving(true);
    try {
      const updated = await api<Issue>(`/api/work/issues/${issueKey}`, {
        method: "PATCH",
        body: JSON.stringify({
          expected_version: detail.issue.version,
          title: draft.title,
          assignee: draft.assignee.trim() || null,
          description: draft.description,
          status: draft.status,
          priority: draft.priority,
        }),
      });
      setDetail((d) => (d ? { ...d, issue: updated } : d));
      setDraft(draftFromIssue(updated));
      onUpdated(updated);
      setEditing(false);
      toast.success("Issue updated");
    } catch (e) {
      if (e instanceof ApiClientError && e.code === "VERSION_CONFLICT") {
        const latest = await api<Detail>(`/api/work/issues/${issueKey}`).catch(
          () => null,
        );
        if (latest) {
          setDetail(latest);
          setDraft(draftFromIssue(latest.issue));
          onUpdated(latest.issue);
        }
        toast.error(
          "Issue changed while you were editing. Latest state loaded; please retry.",
        );
      } else {
        toast.error(e instanceof Error ? e.message : "Update failed");
      }
    } finally {
      setSaving(false);
    }
  }
  async function addComment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!issueKey || !detail) return;
    const form = e.currentTarget,
      fd = new FormData(form);
    try {
      const comment = await api<Comment>(
        `/api/work/issues/${issueKey}/comments`,
        {
          method: "POST",
          body: JSON.stringify({ body: fd.get("body") }),
        },
      );
      setDetail({ ...detail, comments: [...detail.comments, comment] });
      form.reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add comment");
    }
  }
  return (
    <Dialog
      open={Boolean(issueKey)}
      onOpenChange={(open) => {
        if (!open) {
          setEditing(false);
          onClose();
        }
      }}
    >
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="shrink-0 border-b px-6 py-5 pr-14">
          <DialogDescription className="font-mono text-xs font-semibold uppercase tracking-[.14em]">
            {issueKey}
          </DialogDescription>
          <div className="flex items-start justify-between gap-5">
            <DialogTitle
              className="font-heading text-3xl leading-tight sm:text-4xl"
              onDoubleClick={startEditing}
            >
              {detail?.issue.title ?? "Loading issue…"}
            </DialogTitle>
            {detail && !editing && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={startEditing}
              >
                <Pencil />
                Edit
              </Button>
            )}
          </div>
        </DialogHeader>
        {error && (
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <ErrorState message={error} />
          </div>
        )}
        {!detail && !error && (
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <LoadingState />
          </div>
        )}
        {detail && draft && editing && (
          <form
            onSubmit={saveIssue}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Status
                  <Select
                    value={draft.status}
                    disabled={saving}
                    onValueChange={(value) =>
                      setDraft((current) =>
                        current
                          ? { ...current, status: value as IssueStatus }
                          : current,
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {columns.map((column) => (
                        <SelectItem key={column.key} value={column.key}>
                          {column.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="grid gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Priority
                  <Select
                    value={draft.priority}
                    disabled={saving}
                    onValueChange={(value) =>
                      setDraft((current) =>
                        current
                          ? { ...current, priority: value as IssuePriority }
                          : current,
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["critical", "high", "medium", "low"].map((value) => (
                        <SelectItem
                          key={value}
                          value={value}
                          className="capitalize"
                        >
                          {value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_15rem]">
                <label className="grid gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Title
                  <Input
                    value={draft.title}
                    disabled={saving}
                    onChange={(event) =>
                      setDraft((current) =>
                        current
                          ? { ...current, title: event.target.value }
                          : current,
                      )
                    }
                    required
                    autoFocus
                  />
                </label>
                <label className="grid gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Assignee
                  <Input
                    value={draft.assignee}
                    disabled={saving}
                    onChange={(event) =>
                      setDraft((current) =>
                        current
                          ? { ...current, assignee: event.target.value }
                          : current,
                      )
                    }
                    placeholder="Unassigned"
                  />
                  {agents.length > 0 && (
                    <span className="flex flex-wrap gap-1.5">
                      {agents.map((agent) => (
                        <Button
                          key={agent.id}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs font-normal normal-case tracking-normal"
                          onClick={() =>
                            setDraft((current) =>
                              current
                                ? { ...current, assignee: agent.slug }
                                : current,
                            )
                          }
                        >
                          {agent.name}
                        </Button>
                      ))}
                    </span>
                  )}
                </label>
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <label className="grid min-w-0 content-start gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Markdown
                  <Textarea
                    value={draft.description}
                    disabled={saving}
                    onChange={(event) =>
                      setDraft((current) =>
                        current
                          ? { ...current, description: event.target.value }
                          : current,
                      )
                    }
                    className="min-h-80 resize-y font-mono text-sm font-normal normal-case tracking-normal"
                    placeholder="Add context, links, and definition of done…"
                  />
                </label>
                <section className="min-w-0">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Preview
                  </p>
                  <article className="markdown min-h-80 overflow-hidden border-y px-1 py-4">
                    {draft.description ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {draft.description}
                      </ReactMarkdown>
                    ) : (
                      <p className="text-sm italic text-muted-foreground">
                        Nothing to preview yet.
                      </p>
                    )}
                  </article>
                </section>
              </div>
            </div>
            <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none px-6 py-4">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={cancelEditing}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !draft.title.trim()}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        )}
        {detail && !editing && (
          <div className="min-h-0 flex-1 space-y-9 overflow-y-auto px-6 py-6">
            <section className="grid gap-px border bg-border sm:grid-cols-4">
              {[
                {
                  label: "Status",
                  value:
                    columns.find((column) => column.key === detail.issue.status)
                      ?.label ?? detail.issue.status,
                },
                { label: "Priority", value: detail.issue.priority },
                { label: "Type", value: detail.issue.type },
                {
                  label: "Assignee",
                  value: detail.issue.assignee ?? "Unassigned",
                },
              ].map((item) => (
                <div key={item.label} className="min-w-0 bg-card p-4">
                  <p className="text-[0.68rem] font-bold uppercase tracking-[.16em] text-muted-foreground">
                    {item.label}
                  </p>
                  <p className="mt-2 truncate text-sm font-semibold capitalize">
                    {item.value.replaceAll("_", " ")}
                  </p>
                </div>
              ))}
            </section>
            <section>
              <div className="mb-3 flex items-center justify-between gap-4">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Description
                </p>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  Double-click to edit
                </span>
              </div>
              <div
                className="group -mx-3 min-h-28 cursor-text rounded-lg px-3 py-1 transition-colors hover:bg-muted/45"
                onDoubleClick={startEditing}
                title="Double-click to edit this issue"
              >
                {detail.issue.description ? (
                  <article className="markdown py-1">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {detail.issue.description}
                    </ReactMarkdown>
                  </article>
                ) : (
                  <div className="grid min-h-28 place-items-center border-y border-dashed text-sm text-muted-foreground">
                    No description yet. Double-click to add one.
                  </div>
                )}
              </div>
            </section>
            <section>
              <div className="flex items-center gap-2">
                <MessageSquare className="size-4" />
                <h3 className="font-heading text-2xl font-semibold">
                  Comments
                </h3>
              </div>
              <div className="mt-4 divide-y border-y">
                {detail.comments.map((comment) => (
                  <article key={comment.id} className="py-4">
                    <div className="flex justify-between gap-4 text-xs">
                      <strong>{comment.author}</strong>
                      <span className="shrink-0 text-muted-foreground">
                        {formatDateTime(comment.created_at)}
                      </span>
                    </div>
                    <div className="markdown mt-2 text-sm">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {comment.body}
                      </ReactMarkdown>
                    </div>
                  </article>
                ))}
                {!detail.comments.length && (
                  <p className="py-5 text-sm text-muted-foreground">
                    No comments yet.
                  </p>
                )}
              </div>
              <form onSubmit={addComment} className="mt-4 flex items-end gap-2">
                <Textarea
                  name="body"
                  placeholder="Add context or an update…"
                  required
                />
                <Button type="submit" size="icon" aria-label="Add comment">
                  <Check />
                </Button>
              </form>
            </section>
            <section>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Relationships
              </p>
              <pre className="mt-3 overflow-auto bg-muted p-3 font-mono text-xs">
                {JSON.stringify(detail.links, null, 2)}
              </pre>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function WorkBoard({ initialData }: { initialData: WorkPageData }) {
  const [projects, setProjects] = useState<Project[] | null>(
      initialData.projects,
    ),
    [projectKey, setProjectKey] = useState(initialData.projectKey),
    [issues, setIssues] = useState<Issue[] | null>(initialData.issues),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(initialData.error),
    [loadingIssues, setLoadingIssues] = useState(false),
    [testing, setTesting] = useState(false),
    [refreshingProjects, setRefreshingProjects] = useState(false),
    [refreshTick, setRefreshTick] = useState(0),
    skipInitialIssueLoad = useRef(true),
    projectKeyRef = useRef(projectKey);
  useEffect(() => {
    projectKeyRef.current = projectKey;
  }, [projectKey]);
  useEffect(() => {
    if (skipInitialIssueLoad.current) {
      skipInitialIssueLoad.current = false;
      return;
    }
    if (!projectKey) return;
    const controller = new AbortController();
    setLoadingIssues(true);
    setError("");
    api<Issue[]>(`/api/work/issues?project=${encodeURIComponent(projectKey)}`, {
      signal: controller.signal,
    })
      .then((next) => {
        if (!controller.signal.aborted) setIssues(next);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingIssues(false);
      });
    return () => controller.abort();
  }, [projectKey, refreshTick]);
  const grouped = useMemo(
    () =>
      Object.fromEntries(
        columns.map((c) => [
          c.key,
          (issues ?? []).filter((i) => i.status === c.key),
        ]),
      ) as Record<IssueStatus, Issue[]>,
    [issues],
  );
  async function move(key: string, status: IssueStatus) {
    const operationProjectKey = projectKey;
    const before = issues ?? [];
    const currentIssue = before.find((issue) => issue.key === key);
    if (!currentIssue) return;
    setIssues(before.map((i) => (i.key === key ? { ...i, status } : i)));
    try {
      const updated = await api<Issue>(`/api/work/issues/${key}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          expected_version: currentIssue.version,
        }),
      });
      if (projectKeyRef.current === operationProjectKey) {
        setIssues(
          (current) =>
            current?.map((i) => (i.key === key ? updated : i)) ?? null,
        );
      }
    } catch (e) {
      if (projectKeyRef.current !== operationProjectKey) return;
      if (e instanceof ApiClientError && e.code === "VERSION_CONFLICT") {
        const latest = await api<Detail>(`/api/work/issues/${key}`).catch(
          () => null,
        );
        setIssues((current) =>
          current?.map((issue) =>
            issue.key === key ? (latest?.issue ?? currentIssue) : issue,
          ) ?? null,
        );
        toast.error(
          "Issue changed before this move. Latest state loaded; please retry.",
        );
      } else {
        setIssues((current) =>
          current?.map((issue) =>
            issue.key === key ? currentIssue : issue,
          ) ?? null,
        );
        toast.error(e instanceof Error ? e.message : "Could not move issue");
      }
    }
  }
  function replace(updated: Issue) {
    setIssues(
      (current) =>
        current?.map((i) => (i.key === updated.key ? updated : i)) ?? null,
    );
  }
  async function testConnection() {
    setTesting(true);
    try {
      const result = await api<SetupStatus>("/api/setup/check", {
        method: "POST",
        body: JSON.stringify({ service: "work" }),
      });
      const check = result.checks.find((item) => item.service === "work");
      if (check?.state !== "connected")
        throw new Error(check?.detail ?? "Slab is unavailable");
      toast.success("Slab connected");
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not test Slab",
      );
    } finally {
      setTesting(false);
    }
  }
  async function refreshProjects() {
    setRefreshingProjects(true);
    setError("");
    try {
      const next = await api<Project[]>("/api/work/projects");
      setProjects(next);
      const nextKey = next[0]?.key ?? "";
      setProjectKey(nextKey);
      if (!nextKey) setIssues([]);
      toast.success(next.length ? "Projects refreshed" : "No projects found");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not refresh projects",
      );
    } finally {
      setRefreshingProjects(false);
    }
  }
  return (
    <>
      <PageHeader
        title="Work"
        description={`${projectKey || "No project"} · ${issues?.length ?? 0} items · Slab source`}
        actions={
          <>
            <Button
              variant="outline"
              size="icon"
              onClick={() => projectKey && setRefreshTick((value) => value + 1)}
              aria-label="Refresh"
            >
              <RefreshCw />
            </Button>
            <CreateIssue
              projectKey={projectKey}
              agents={initialData.agents}
              onCreated={(issue) => setIssues((v) => [issue, ...(v ?? [])])}
            />
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="text-xs font-bold uppercase tracking-[.16em] text-muted-foreground">
          Project
        </span>
        <Select value={projectKey} onValueChange={setProjectKey}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Choose a project" />
          </SelectTrigger>
          <SelectContent>
            {projects?.map((p) => (
              <SelectItem key={p.key} value={p.key}>
                {p.key} · {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="mb-4 flex flex-col justify-between gap-2 rounded-md border bg-muted/35 px-3 py-2 text-xs sm:flex-row sm:items-center">
        <span className="flex items-center gap-2 font-semibold">
          <Bot className="size-4" />
          Agent routing is active
        </span>
        <p className="text-muted-foreground">
          Assign an enabled agent slug to start work automatically. Mention an
          agent in a comment, such as <code>@coo</code>, to request input.
        </p>
      </div>
      {error && <ErrorState message={error} />}{" "}
      {!projects && !error && <LoadingState />}
      {projects && !projects.length && (
        <EmptyState
          title="No Slab projects"
          description="Verify the remote source, refresh this view, or open Slab to create the first project. This workspace never mirrors remote work."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="outline"
                onClick={testConnection}
                disabled={testing}
              >
                {testing ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <PlugZap />
                )}
                Test Slab connection
              </Button>
              <Button
                variant="outline"
                onClick={refreshProjects}
                disabled={refreshingProjects}
              >
                <RefreshCw
                  className={refreshingProjects ? "animate-spin" : ""}
                />
                Refresh projects
              </Button>
              {initialData.externalUrl && (
                <Button asChild>
                  <a
                    href={initialData.externalUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink />
                    Open Slab
                  </a>
                </Button>
              )}
            </div>
          }
        />
      )}
      {loadingIssues && <LoadingState label="Loading issues" />}
      {projects && projects.length > 0 && issues && !loadingIssues && (
        <div className="grid grid-cols-[repeat(5,minmax(15rem,1fr))] gap-3 overflow-x-auto pb-3">
          {columns.map((column) => (
            <section
              key={column.key}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const key = e.dataTransfer.getData("text/plain");
                if (key) void move(key, column.key);
              }}
              className="min-h-[28rem] rounded-md border border-t-2 border-t-foreground bg-muted/40 p-2.5"
            >
              <header className="mb-3 flex items-start justify-between px-1 pt-1">
                <div>
                  <h2 className="text-sm font-semibold">{column.label}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {column.caption}
                  </p>
                </div>
                <Badge variant="outline" className="tabular-nums">
                  {grouped[column.key].length}
                </Badge>
              </header>
              <div className="space-y-2">
                {grouped[column.key].map((issue) => (
                  <button
                    key={issue.key}
                    draggable
                    onDragStart={(e) =>
                      e.dataTransfer.setData("text/plain", issue.key)
                    }
                    onClick={() => setSelected(issue.key)}
                    className="group w-full cursor-grab rounded-md bg-card p-3 text-left ring-1 ring-border transition-colors hover:bg-background hover:ring-foreground/30 active:cursor-grabbing"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-mono text-[0.68rem] font-semibold text-muted-foreground">
                        {issue.key}
                      </span>
                      <Badge className={priorityTone[issue.priority]}>
                        {issue.priority}
                      </Badge>
                    </div>
                    <h3 className="mt-2 line-clamp-3 text-[0.82rem] font-semibold leading-[1.25rem]">
                      {issue.title}
                    </h3>
                    <div className="mt-3 flex items-center justify-between text-[0.68rem] text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        {issue.type === "bug" ? (
                          <Bug className="size-3.5" />
                        ) : (
                          <CircleDot className="size-3.5" />
                        )}
                        {issue.type}
                      </span>
                      <span className="flex items-center gap-1">
                        <User className="size-3.5" />
                        {issue.assignee ?? "Unassigned"}
                      </span>
                    </div>
                  </button>
                ))}
                {!grouped[column.key].length && (
                  <div className="grid min-h-24 place-items-center border border-dashed text-xs text-muted-foreground">
                    Drop work here
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
      <IssueDialog
        issueKey={selected}
        agents={initialData.agents}
        onClose={() => setSelected(null)}
        onUpdated={replace}
      />
    </>
  );
}
