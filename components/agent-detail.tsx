"use client";
import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Bot,
  CalendarClock,
  LayoutDashboard,
  ListTodo,
  MessageSquare,
  Play,
  ScrollText,
  Sparkles,
  Puzzle,
  BookOpenText,
} from "lucide-react";
import { toast } from "sonner";
import { AgentChatDialog } from "@/components/agent-chat-dialog";
import { AgentRunDialog } from "@/components/agent-run-dialog";
import { AgentQuickActionsEditor } from "@/components/agent-quick-actions-editor";
import { AgentToolPolicyEditor } from "@/components/agent-tool-policy-editor";
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
import {
  SettingRow,
  SettingSection,
  SettingsStatusBadge,
  settingControlWidths,
} from "@/components/settings-layout";
import {
  SectionNavigationFrame,
  sectionNavigationItemClass,
  sectionNavigationItemsClass,
  sectionNavigationScrollerClass,
} from "@/components/section-navigation";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/client-api";
import type { AgentDetailData, Integration } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

const AGENT_PAGES = {
  overview: {
    label: "Overview",
    description: "Current state, execution defaults, and operator actions.",
    icon: LayoutDashboard,
  },
  instructions: {
    label: "Instructions",
    description: "Persistent operating instructions used for every new run.",
    icon: ScrollText,
  },
  capabilities: {
    label: "Capabilities",
    description: "Permissions, knowledge sources, and connected tools.",
    icon: Puzzle,
  },
  automations: {
    label: "Automations",
    description: "Recurring and event-triggered work assigned to this agent.",
    icon: CalendarClock,
  },
  runs: {
    label: "Runs",
    description: "Recent execution history for this agent.",
    icon: Activity,
  },
} as const;

type AgentPage = keyof typeof AGENT_PAGES;

export function AgentDetail({ data }: { data: AgentDetailData }) {
  const [activePage, setActivePage] = useState<AgentPage>("overview");
  const [quickActions, setQuickActions] = useState(data.quickActions),
    [integrations, setIntegrations] = useState(data.integrations),
    [savingIntegration, setSavingIntegration] = useState<string | null>(null);
  const [knowledgeSources, setKnowledgeSources] = useState(
    data.knowledgeSources,
  );
  const [savingSource, setSavingSource] = useState<string | null>(null);
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

  async function changeSourceAccess(sourceId: string, enabled: boolean) {
    const source = knowledgeSources.find((item) => item.id === sourceId);
    if (!source) return;
    setSavingSource(sourceId);
    try {
      const next = await api<(typeof knowledgeSources)[number]>(
        `/api/agents/${data.agent.id}/sources`,
        {
          method: "PATCH",
          body: JSON.stringify({
            sourceId,
            enabled,
            expectedAccessVersion: source.accessVersion,
          }),
        },
      );
      setKnowledgeSources((current) =>
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
          : "Could not update source access",
      );
    } finally {
      setSavingSource(null);
    }
  }

  const { agent } = data;
  const activeRun = data.runs.find((run) =>
    ["running", "waiting_approval", "queued"].includes(run.status),
  );
  const queued = data.runs.filter((run) => run.status === "queued").length;
  const state = !agent.enabled ? "disabled" : (activeRun?.status ?? "idle");
  const page = AGENT_PAGES[activePage];
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
      <Tabs
        value={activePage}
        onValueChange={(value) => {
          if (value in AGENT_PAGES) setActivePage(value as AgentPage);
        }}
        className="gap-0"
      >
        <SectionNavigationFrame>
          <div className={sectionNavigationScrollerClass}>
            <TabsList
              variant="line"
              aria-label={`${agent.name} sections`}
              className={cn(
                sectionNavigationItemsClass,
                "h-auto w-max justify-start rounded-none p-0",
              )}
            >
              {Object.entries(AGENT_PAGES).map(
                ([value, { label, icon: Icon }]) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className={cn(
                      sectionNavigationItemClass,
                      "flex-none font-[525] text-muted-foreground after:!bottom-[-1px] data-active:font-[650] data-active:text-foreground [&_svg]:text-muted-foreground/75 data-active:[&_svg]:text-foreground",
                    )}
                  >
                    <Icon aria-hidden="true" className="size-3.5" />
                    {label}
                  </TabsTrigger>
                ),
              )}
            </TabsList>
          </div>
        </SectionNavigationFrame>

        <main className="min-w-0 max-w-[80rem] pt-6">
          <div className="mb-5">
            <h2 className="text-xl font-semibold tracking-[-0.025em]">
              {page.label}
            </h2>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              {page.description}
            </p>
          </div>

          <TabsContent value="overview" className="space-y-6">
            <SettingSection
              title="Agent status"
              description="Live operational state and execution defaults."
            >
              <SettingRow
                title="Current state"
                description={
                  activeRun?.issueKey
                    ? `Working on ${activeRun.issueKey}.`
                    : activeRun?.mode === "review"
                      ? "Running an operational review."
                      : "No active work assigned."
                }
              >
                <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-2">
                  <StatusBadge status={state} />
                  <span className="text-sm text-muted-foreground">
                    {queued ? `${queued} queued` : "Queue clear"}
                  </span>
                  <SettingsStatusBadge tone="neutral">
                    {agent.permissionMode} permissions
                  </SettingsStatusBadge>
                </div>
              </SettingRow>
              <SettingRow
                title="Runtime"
                description="New runs snapshot this runtime and model. Queued and historical runs keep their original selection."
                layout="wide"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                  <label
                    className={cn(
                      "grid gap-1.5 text-xs font-semibold",
                      settingControlWidths.compact,
                    )}
                  >
                    Runtime
                    <Select
                      value={runtime}
                      onValueChange={(value) => {
                        setRuntime(value);
                        setModel("default");
                      }}
                    >
                      <SelectTrigger className="w-full">
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
                  </label>
                  <label
                    className={cn(
                      "grid gap-1.5 text-xs font-semibold",
                      settingControlWidths.medium,
                    )}
                  >
                    Model
                    <Select value={model} onValueChange={setModel}>
                      <SelectTrigger className="w-full">
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
                  </label>
                  <Button
                    variant="outline"
                    onClick={saveRuntime}
                    disabled={savingRuntime}
                    className="w-fit"
                  >
                    {savingRuntime ? "Saving…" : "Save runtime"}
                  </Button>
                </div>
              </SettingRow>
              <SettingRow
                title="Permissions"
                description="Control which assigned tools run automatically or require approval."
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-fit"
                  onClick={() => setActivePage("capabilities")}
                >
                  Manage permissions
                  <ArrowRight />
                </Button>
              </SettingRow>
            </SettingSection>

            <SettingSection
              title="Quick tasks"
              description="Start ad-hoc work or reuse a configured instruction."
              action={
                <AgentQuickActionsEditor
                  agentId={agent.id}
                  actions={quickActions}
                  onChange={setQuickActions}
                />
              }
            >
              <SettingRow
                title="Start work"
                description={`${quickActions.length} reusable ${quickActions.length === 1 ? "task" : "tasks"} configured.`}
                layout="wide"
              >
                <div className="flex flex-wrap gap-2">
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
              </SettingRow>
            </SettingSection>

            <SettingSection
              title="Threads"
              description={`${data.threads.length} ${data.threads.length === 1 ? "conversation" : "conversations"}.`}
            >
              {data.threads.map((thread) => (
                <SettingRow
                  key={thread.id}
                  title={
                    <span className="flex min-w-0 items-center gap-2">
                      <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{thread.title}</span>
                    </span>
                  }
                  description={`Updated ${formatDateTime(thread.updatedAt)}`}
                >
                  <Button asChild variant="ghost" size="sm" className="w-fit">
                    <Link href={`/agents/${agent.id}/threads/${thread.id}`}>
                      Open thread
                      <ArrowRight />
                    </Link>
                  </Button>
                </SettingRow>
              ))}
              {!data.threads.length ? (
                <SettingRow
                  title="No conversations yet"
                  description="Chat with this agent to create its first product thread."
                >
                  <AgentChatDialog agent={agent} />
                </SettingRow>
              ) : null}
            </SettingSection>
          </TabsContent>

          <TabsContent value="instructions">
            <SettingSection
              title="Agent instructions"
              description="Persistent identity, operating rules, and domain context."
            >
              <SettingRow
                title={
                  <span className="inline-flex items-center gap-2">
                    <Bot className="size-4 text-muted-foreground" />
                    System instructions
                  </span>
                }
                description="Applied to each new execution context."
                layout="wide"
              >
                <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-4 font-sans text-sm leading-6">
                  {agent.instructions}
                </pre>
              </SettingRow>
            </SettingSection>
          </TabsContent>

          <TabsContent value="capabilities" className="space-y-6">
            <AgentToolPolicyEditor
              agent={agent}
              initialPolicies={data.toolPolicies}
              catalog={data.toolCatalog}
              integrations={integrations}
            />
            <SettingSection
              title="Knowledge sources"
              description="Choose which synchronized collections this agent can read in new runs."
            >
              {knowledgeSources.map((source) => {
                const assigned = source.agentIds.includes(agent.id);
                return (
                  <SettingRow
                    key={source.id}
                    title={
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <BookOpenText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{source.name}</span>
                      </span>
                    }
                    description={`${source.kind} · ${source.itemCount} documents · ${source.status.replaceAll("_", " ")}`}
                  >
                    <Switch
                      checked={assigned}
                      disabled={savingSource === source.id}
                      onCheckedChange={(checked) =>
                        changeSourceAccess(source.id, checked)
                      }
                      aria-label={`${source.name} for ${agent.name}`}
                    />
                  </SettingRow>
                );
              })}
              {!knowledgeSources.length ? (
                <SettingRow
                  title="No knowledge sources configured"
                  description="Add a source before assigning collection-level access."
                >
                  <Button asChild variant="ghost" size="sm" className="w-fit">
                    <Link href="/docs">Open Docs</Link>
                  </Button>
                </SettingRow>
              ) : null}
            </SettingSection>
            <SettingSection
              title="Integrations"
              description="Choose which configured capabilities are included in this agent's next run."
            >
              {integrations.map((integration) => {
                const assigned =
                  (integration.permissions[agent.id] ?? []).length > 0;
                return (
                  <SettingRow
                    key={integration.id}
                    title={
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <Puzzle className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{integration.name}</span>
                      </span>
                    }
                    description={`${integration.tools.length} tools · ${integration.status.replace("_", " ")}${
                      integration.provider.startsWith("calendar_")
                        ? ` · ${integration.writePolicy?.replace("_", " ") ?? "approval required"}`
                        : ""
                    }`}
                  >
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
                  </SettingRow>
                );
              })}
              {!integrations.length ? (
                <SettingRow
                  title="No integrations configured"
                  description="Connect a capability before assigning it to this agent."
                >
                  <Button asChild variant="ghost" size="sm" className="w-fit">
                    <Link href="/integrations">Open Integrations</Link>
                  </Button>
                </SettingRow>
              ) : null}
            </SettingSection>
          </TabsContent>

          <TabsContent value="automations">
            <SettingSection
              title="Assigned automations"
              description="Recurring and event-triggered work routed to this agent."
            >
              {data.automations.map((item) => (
                <SettingRow
                  key={item.id}
                  title={
                    <span className="inline-flex items-center gap-2">
                      <CalendarClock className="size-4 text-muted-foreground" />
                      {item.name}
                    </span>
                  }
                  description="Automation schedule"
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    {item.cronExpression ?? "Manual"}
                  </span>
                </SettingRow>
              ))}
              {!data.automations.length ? (
                <SettingRow
                  title="Nothing scheduled"
                  description="This agent has no assigned automations."
                >
                  <Button asChild variant="ghost" size="sm" className="w-fit">
                    <Link href="/automations">Open Automations</Link>
                  </Button>
                </SettingRow>
              ) : null}
            </SettingSection>
          </TabsContent>

          <TabsContent value="runs">
            <SettingSection
              title="Recent runs"
              description="Execution history, status, trigger, and mode."
            >
              {data.runs.map((run) => (
                <SettingRow
                  key={run.id}
                  title={<span className="font-mono text-xs">{run.id}</span>}
                  description={`${run.mode.replaceAll("_", " ")} · ${run.trigger.replaceAll("_", " ")}`}
                >
                  <div className="flex min-h-9 flex-wrap items-center gap-3">
                    <StatusBadge status={run.status} />
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/runs/${run.id}`}>
                        View run
                        <ArrowRight />
                      </Link>
                    </Button>
                  </div>
                </SettingRow>
              ))}
              {!data.runs.length ? (
                <SettingRow
                  title="No runs yet"
                  description="Give this agent a task to create its first run."
                >
                  <AgentRunDialog
                    agent={agent}
                    label="Give task"
                    icon={ListTodo}
                    variant="default"
                  />
                </SettingRow>
              ) : null}
            </SettingSection>
          </TabsContent>
        </main>
      </Tabs>
    </>
  );
}
