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
  ShieldCheck,
  Sparkles,
  Puzzle,
} from "lucide-react";
import { toast } from "sonner";
import { AgentChatDialog } from "@/components/agent-chat-dialog";
import { AgentRunDialog } from "@/components/agent-run-dialog";
import { AgentQuickActionsEditor } from "@/components/agent-quick-actions-editor";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/client-api";
import type { AgentDetailData, Integration } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
export function AgentDetail({ data }: { data: AgentDetailData }) {
  const [fullAccess, setFullAccess] = useState(data.agent.fullAccess),
    [savingAccess, setSavingAccess] = useState(false),
    [quickActions, setQuickActions] = useState(data.quickActions),
    [integrations, setIntegrations] = useState(data.integrations),
    [savingIntegration, setSavingIntegration] = useState<string | null>(null);
  const [runtime, setRuntime] = useState(data.agent.runtime);
  const [model, setModel] = useState(data.agent.model);
  const [savingRuntime, setSavingRuntime] = useState(false);

  async function saveRuntime() {
    setSavingRuntime(true);
    try {
      await api(`/api/agents/${data.agent.id}`, {
        method: "PATCH",
        body: JSON.stringify({ runtime, model }),
      });
      toast.success("Agent runtime updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update runtime",
      );
    } finally {
      setSavingRuntime(false);
    }
  }

  async function changeIntegrationAccess(
    integration: Integration,
    enabled: boolean,
  ) {
    setSavingIntegration(integration.id);
    try {
      const next = await api<Integration>(
        `/api/agents/${data.agent.id}/integrations/${integration.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            enabled,
            expectedVersion: integration.version,
          }),
        },
      );
      setIntegrations((current) =>
        current.map((item) => (item.id === next.id ? next : item)),
      );
      toast.success(
        enabled
          ? `${next.name} enabled for ${data.agent.name}`
          : `${next.name} disabled for ${data.agent.name}`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update integration access",
      );
    } finally {
      setSavingIntegration(null);
    }
  }

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
  const { agent } = data;
  const activeRun = data.runs.find((run) =>
    ["running", "waiting_approval", "queued"].includes(run.status),
  );
  const queued = data.runs.filter((run) => run.status === "queued").length;
  const state = !agent.enabled ? "disabled" : (activeRun?.status ?? "idle");
  return (
    <>
      <PageHeader
        title={agent.name}
        description={`${agent.role} · ${runtime} · ${model}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <AgentChatDialog agent={agent} />
            <AgentRunDialog
              agent={agent}
              label="Give task"
              icon={ListTodo}
              variant="default"
            />
          </div>
        }
      />
      <Tabs defaultValue="overview" className="space-y-5">
        <TabsList className="h-9 w-full justify-start overflow-x-auto rounded-lg border bg-card p-1 sm:w-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="instructions">Instructions</TabsTrigger>
          <TabsTrigger value="capabilities">Capabilities</TabsTrigger>
          <TabsTrigger value="automations">Automations</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-5">
          <section className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-2 xl:grid-cols-5">
            {[
              { label: "State", value: state.replaceAll("_", " ") },
              {
                label: "Current work",
                value:
                  activeRun?.issueKey ??
                  (activeRun?.mode === "review" ? "Operational review" : "—"),
              },
              { label: "Queue", value: queued ? `${queued} queued` : "Clear" },
              { label: "Runtime", value: runtime },
              { label: "Tool access", value: fullAccess ? "Full" : "Guarded" },
            ].map((item) => (
              <div
                key={item.label}
                className="min-h-20 border-b p-3 sm:odd:border-r xl:border-b-0 xl:border-r xl:last:border-r-0"
              >
                <p className="text-[0.68rem] font-semibold uppercase tracking-[.08em] text-muted-foreground">
                  {item.label}
                </p>
                <p className="mt-2 truncate text-sm font-semibold capitalize">
                  {item.value}
                </p>
              </div>
            ))}
          </section>

          <section className="rounded-lg border bg-card p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="grid flex-1 gap-1.5 text-xs font-semibold">
                Runtime
                <Select
                  value={runtime}
                  onValueChange={(value) => {
                    setRuntime(value);
                    setModel("default");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {data.runtimes
                      .filter(
                        (item) =>
                          (item.enabled &&
                            item.registered &&
                            item.health === "available") ||
                          item.id === runtime,
                      )
                      .map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.displayName}
                          {!item.enabled ? " · disabled" : ""}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid flex-1 gap-1.5 text-xs font-semibold">
                Model
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      ...new Set([
                        model,
                        ...(data.runtimes.find(({ id }) => id === runtime)
                          ?.models ?? ["default"]),
                      ]),
                    ].map((item) => (
                      <SelectItem key={item} value={item}>
                        {item === "default" ? "Workspace default" : item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                onClick={saveRuntime}
                disabled={savingRuntime}
              >
                {savingRuntime ? "Saving…" : "Save runtime"}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              New runs snapshot this runtime and model. Existing queued and
              historical runs keep their original selection.
            </p>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Quick tasks</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Start ad-hoc work or reuse a configured prompt.
                </p>
              </div>
              <AgentQuickActionsEditor
                agentId={agent.id}
                actions={quickActions}
                onChange={setQuickActions}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <AgentRunDialog
                agent={agent}
                label="Run now"
                icon={Play}
                variant="default"
                defaultMode="review"
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

          <section className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Threads</h2>
              <span className="text-xs text-muted-foreground">
                {data.threads.length} conversations
              </span>
            </div>
            <div className="mt-3 divide-y border-y">
              {data.threads.map((thread) => (
                <Link
                  key={thread.id}
                  href={`/agents/${agent.id}/threads/${thread.id}`}
                  className="group flex min-h-12 items-center justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <MessageSquare className="size-3.5 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {thread.title}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Updated {formatDateTime(thread.updatedAt)}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </Link>
              ))}
              {!data.threads.length && (
                <p className="py-5 text-sm text-muted-foreground">
                  No conversations yet.
                </p>
              )}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="instructions">
          <section className="rounded-lg border bg-card p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <Bot className="size-4" />
              <h2 className="text-sm font-semibold">System instructions</h2>
            </div>
            <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-4 font-sans text-sm leading-6">
              {agent.instructions}
            </pre>
          </section>
        </TabsContent>

        <TabsContent value="capabilities" className="space-y-5">
          <section className="rounded-lg border bg-card p-4">
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
          <section className="rounded-lg border bg-card p-4">
            <div>
              <h2 className="text-sm font-semibold">Integrations</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Choose which configured capabilities are included in this
                agent&apos;s next run.
              </p>
            </div>
            {integrations.length ? (
              <div className="mt-4 divide-y rounded-md border">
                {integrations.map((integration) => {
                  const assigned =
                    (integration.permissions[agent.id] ?? []).length > 0;
                  return (
                    <div
                      key={integration.id}
                      className="flex items-center justify-between gap-4 p-4"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Puzzle className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {integration.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {integration.tools.length} tools ·{" "}
                            {integration.status.replace("_", " ")}
                            {integration.provider.startsWith("calendar_")
                              ? ` · ${integration.writePolicy?.replace("_", " ") ?? "approval required"}`
                              : ""}
                          </p>
                        </div>
                      </div>
                      <Switch
                        checked={assigned}
                        disabled={
                          savingIntegration === integration.id ||
                          !integration.enabled ||
                          integration.status !== "connected"
                        }
                        onCheckedChange={(checked) =>
                          changeIntegrationAccess(integration, checked)
                        }
                        aria-label={`${integration.name} for ${agent.name}`}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                No integrations configured. Add one from Settings.
              </p>
            )}
          </section>
        </TabsContent>

        <TabsContent value="automations">
          <section className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2">
              <CalendarClock className="size-4" />
              <h2 className="text-sm font-semibold">Automations</h2>
            </div>
            <div className="mt-3 divide-y border-y">
              {data.automations.map((item) => (
                <div
                  key={item.id}
                  className="grid min-h-14 gap-1 py-2 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <p className="text-sm font-semibold">{item.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {item.cronExpression ?? "Manual"}
                  </p>
                </div>
              ))}
              {!data.automations.length && (
                <p className="py-5 text-sm text-muted-foreground">
                  Nothing scheduled.
                </p>
              )}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="runs">
          <section className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">Recent runs</h2>
            <div className="mt-3 divide-y border-y">
              {data.runs.map((run) => (
                <Link
                  key={run.id}
                  href={`/runs/${run.id}`}
                  className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs">
                      {run.id}
                    </span>
                    <span className="mt-0.5 block text-xs capitalize text-muted-foreground">
                      {run.mode.replaceAll("_", " ")} ·{" "}
                      {run.trigger.replaceAll("_", " ")}
                    </span>
                  </span>
                  <StatusBadge status={run.status} />
                </Link>
              ))}
              {!data.runs.length && (
                <p className="py-5 text-sm text-muted-foreground">
                  No runs yet.
                </p>
              )}
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </>
  );
}
