"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  CalendarClock,
  ListTodo,
  MessageSquare,
  Play,
  Radio,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { AgentRunDialog } from "@/components/agent-run-dialog";
import { AgentQuickActionsEditor } from "@/components/agent-quick-actions-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/client-api";
import type { AgentDetailData, Thread } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
export function AgentDetail({ data }: { data: AgentDetailData }) {
  const [open, setOpen] = useState(false),
    [creating, setCreating] = useState(false),
    [fullAccess, setFullAccess] = useState(data.agent.fullAccess),
    [savingAccess, setSavingAccess] = useState(false),
    [quickActions, setQuickActions] = useState(data.quickActions);

  async function changeFullAccess(next: boolean) {
    if (savingAccess) return;
    const previous = fullAccess;
    setFullAccess(next);
    setSavingAccess(true);
    try {
      await api(`/api/agents/${data.agent.id}`, {
        method: "PATCH",
        body: JSON.stringify({ fullAccess: next }),
      });
      toast.success(
        next
          ? "Full Work and Docs access enabled"
          : "Approval guardrails restored",
      );
    } catch (error) {
      setFullAccess(previous);
      toast.error(
        error instanceof Error ? error.message : "Could not update tool access",
      );
    } finally {
      setSavingAccess(false);
    }
  }
  async function createThread(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    setCreating(true);
    const form = new FormData(event.currentTarget);
    try {
      const thread = await api<Thread>("/api/threads", {
        method: "POST",
        body: JSON.stringify({
          agentId: data.agent.id,
          title: form.get("title"),
        }),
      });
      window.location.assign(
        new URL(
          `/agents/${data.agent.id}/threads/${thread.id}`,
          window.location.origin,
        ).href,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create thread");
      setCreating(false);
    }
  }
  const { agent } = data;
  return (
    <>
      <PageHeader
        eyebrow="Agent detail"
        title={agent.name}
        description={agent.role}
        actions={
          <div className="flex flex-wrap gap-2">
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <MessageSquare />
                  Chat
                </Button>
              </DialogTrigger>
              <DialogContent>
                <form onSubmit={createThread}>
                  <DialogHeader>
                    <DialogTitle className="font-heading text-3xl">
                      Chat with {agent.name}
                    </DialogTitle>
                  </DialogHeader>
                  <label className="mt-6 grid gap-2 text-sm font-semibold">
                    Conversation title
                    <Input
                      name="title"
                      defaultValue="General"
                      autoFocus
                      required
                    />
                  </label>
                  <DialogFooter className="mt-6">
                    <Button type="submit" disabled={creating}>
                      <MessageSquare />
                      {creating ? "Opening…" : "Start chat"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
            <AgentRunDialog
              agent={agent}
              label="Give task"
              icon={ListTodo}
              variant="default"
            />
          </div>
        }
      />
      <div className="grid gap-8 xl:grid-cols-[1fr_20rem]">
        <div className="space-y-10">
          <section className="border-y bg-muted/20 px-5 py-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-3">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p
                    id="agent-full-access-label"
                    className="text-sm font-semibold"
                  >
                    Full access to Work & Docs
                  </p>
                  <p
                    id="agent-full-access-description"
                    className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground"
                  >
                    {fullAccess
                      ? "Enabled. This agent can read and change Work and Docs without approval. Runtime commands remain guarded."
                      : "Disabled. Reads run automatically, but changes to Work or Docs require approval."}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                <span className="text-xs font-bold uppercase tracking-[.14em] text-muted-foreground">
                  {savingAccess
                    ? "Saving…"
                    : fullAccess
                      ? "Enabled"
                      : "Enable full access"}
                </span>
                <Switch
                  checked={fullAccess}
                  onCheckedChange={changeFullAccess}
                  disabled={savingAccess}
                  aria-describedby="agent-full-access-description"
                  aria-labelledby="agent-full-access-label"
                />
              </div>
            </div>
          </section>
          <section className="grid gap-px overflow-hidden border bg-border sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Runtime", value: "Codex", icon: Bot },
              {
                label: "Status",
                value: agent.enabled ? "Idle" : "Disabled",
                icon: Radio,
              },
              { label: "Model", value: agent.model, icon: Bot },
              {
                label: "Tool access",
                value: fullAccess ? "Full" : "Guarded",
                icon: ShieldCheck,
              },
            ].map((item) => (
              <div className="bg-card p-5" key={item.label}>
                <item.icon className="size-4 text-muted-foreground" />
                <p className="mt-8 text-xs font-bold uppercase tracking-[.16em] text-muted-foreground">
                  {item.label}
                </p>
                <p className="mt-1 text-lg font-semibold capitalize">
                  {item.value}
                </p>
              </div>
            ))}
          </section>
          <section className="border-y py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[.16em] text-primary">
                  Quick tasks
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Start ad-hoc work or reuse a configured prompt.
                </p>
              </div>
              <AgentQuickActionsEditor
                agentId={agent.id}
                actions={quickActions}
                onChange={setQuickActions}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <AgentRunDialog
                agent={agent}
                label="Run now"
                icon={Play}
                variant="default"
              />
              {quickActions.map((action) => (
                <AgentRunDialog
                  key={action.id}
                  agent={agent}
                  label={action.label}
                  icon={Sparkles}
                  defaultPrompt={action.prompt}
                  variant="outline"
                />
              ))}
            </div>
          </section>
          <section>
            <h2 className="font-heading text-3xl font-semibold">Threads</h2>
            <div className="mt-4 divide-y border-y">
              {data.threads.map((thread) => (
                <Link
                  key={thread.id}
                  href={`/agents/${agent.id}/threads/${thread.id}`}
                  className="group flex items-center justify-between py-4"
                >
                  <div className="flex items-center gap-3">
                    <MessageSquare className="size-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-semibold">{thread.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Updated {formatDateTime(thread.updatedAt)}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </Link>
              ))}
              {!data.threads.length && (
                <EmptyState
                  title="No conversations yet"
                  description="Start a thread to give this agent its first job."
                />
              )}
            </div>
          </section>
          <section>
            <h2 className="font-heading text-3xl font-semibold">Recent runs</h2>
            <div className="mt-4 divide-y border-y">
              {data.runs.map((run) => (
                <Link
                  key={run.id}
                  href={`/runs/${run.id}`}
                  className="flex items-center justify-between py-4"
                >
                  <span className="font-mono text-sm">
                    {run.id.slice(0, 12)}
                  </span>
                  <StatusBadge status={run.status} />
                </Link>
              ))}
              {!data.runs.length && (
                <p className="py-6 text-sm text-muted-foreground">
                  No runs yet.
                </p>
              )}
            </div>
          </section>
        </div>
        <aside className="space-y-8">
          <section>
            <p className="text-xs font-bold uppercase tracking-[.16em] text-muted-foreground">
              Instructions
            </p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
              {agent.instructions}
            </p>
          </section>
          <section>
            <div className="flex items-center gap-2">
              <CalendarClock className="size-4" />
              <p className="text-xs font-bold uppercase tracking-[.16em] text-muted-foreground">
                Automations
              </p>
            </div>
            <div className="mt-3 space-y-3">
              {data.automations.map((item) => (
                <div key={item.id} className="border-t pt-3">
                  <p className="text-sm font-semibold">{item.name}</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {item.cronExpression}
                  </p>
                </div>
              ))}
              {!data.automations.length && (
                <p className="text-sm text-muted-foreground">
                  Nothing scheduled.
                </p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
