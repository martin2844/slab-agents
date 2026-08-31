"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  CalendarClock,
  Copy,
  Mail,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import {
  DenseTable,
  SectionHeader,
  denseTableCell,
  denseTableHead,
} from "@/components/operational-ui";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOperationalPolling } from "@/components/use-operational-polling";
import { AUTOMATION_TEMPLATES } from "@/lib/automation-templates";
import { api } from "@/lib/client-api";
import type {
  Automation,
  AutomationExecution,
  AutomationStepExecution,
  AutomationsData,
} from "@/lib/types";
import {
  formatDateTime,
  formatRelativeFuture,
  formatRelativePast,
} from "@/lib/utils";

type ExecutionWithSteps = AutomationExecution & {
  steps: AutomationStepExecution[];
};

type ActivityResponse = {
  automations: Automation[];
  executions: ExecutionWithSteps[];
};

function automationStatus(automation: Automation) {
  if (
    automation.lifecycleStatus === "enabled" &&
    automation.lastRunStatus === "failed"
  ) {
    return "error";
  }
  return automation.lifecycleStatus;
}

function triggerSummary(automation: Automation) {
  if (automation.triggerType === "email") {
    const ruleCount = [
      automation.emailMatch.recipientAddress,
      automation.emailMatch.senderAddress,
      automation.emailMatch.senderDomain,
      automation.emailMatch.subjectIncludes,
    ].filter(Boolean).length;
    return {
      icon: Mail,
      title: "Inbox email",
      detail: ruleCount
        ? `${automation.emailMatch.matchMode === "any" ? "Any" : "All"} of ${ruleCount} ${ruleCount === 1 ? "rule" : "rules"}`
        : "Every inbound message",
    };
  }
  return {
    icon: CalendarClock,
    title: automation.cronExpression ? "Schedule" : "Manual only",
    detail: automation.cronExpression
      ? `${automation.cronExpression} · ${automation.scheduleTimezone}`
      : "Starts only from a test run",
  };
}

function Templates() {
  return (
    <section>
      <SectionHeader
        title="Start from a proven workflow"
        meta="Templates are saved as drafts until you activate them."
      />
      <div className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-2 xl:grid-cols-5">
        {AUTOMATION_TEMPLATES.map((template, index) => {
          const Icon = template.triggerType === "email" ? Mail : CalendarClock;
          return (
            <Link
              key={template.id}
              href={`/automations/new?template=${template.id}`}
              className={`group min-h-36 border-b p-4 transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:odd:border-r xl:border-r xl:border-b-0 xl:last:border-r-0 ${
                index === AUTOMATION_TEMPLATES.length - 1 ? "sm:border-b-0" : ""
              }`}
            >
              <span className="flex items-center gap-2 font-mono text-[0.68rem] text-muted-foreground">
                <Icon className="size-3.5" />
                {template.triggerType === "email" ? "Inbox" : "Schedule"}
              </span>
              <h3 className="mt-5 text-sm font-[650] tracking-[-0.015em]">
                {template.name}
              </h3>
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                {template.description}
              </p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                Use template <Plus className="size-3" />
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function OperationalSummary({ automations }: { automations: Automation[] }) {
  const values = [
    [
      "Active",
      automations.filter((item) => item.lifecycleStatus === "enabled").length,
    ],
    [
      "Draft",
      automations.filter((item) => item.lifecycleStatus === "draft").length,
    ],
    [
      "Scheduled",
      automations.filter((item) => item.triggerType === "schedule").length,
    ],
    [
      "Inbox-triggered",
      automations.filter((item) => item.triggerType === "email").length,
    ],
    [
      "Recent failures",
      automations.filter((item) => item.lastRunStatus === "failed").length,
    ],
  ] as const;
  return (
    <section className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-5">
      {values.map(([label, value]) => (
        <div
          key={label}
          className="border-b px-4 py-3 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0"
        >
          <p className="text-lg font-[675] tabular-nums tracking-[-0.025em]">
            {value}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
        </div>
      ))}
    </section>
  );
}

export function AutomationsView({
  initialData,
}: {
  initialData: AutomationsData;
}) {
  const router = useRouter();
  const [automations, setAutomations] = useState(initialData.automations);
  const [executions, setExecutions] = useState<ExecutionWithSteps[]>(
    initialData.executions,
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  useOperationalPolling(async () => {
    const activity = await api<ActivityResponse>("/api/automations?activity=1");
    setAutomations(activity.automations);
    setExecutions(activity.executions);
  }, 5_000);

  const recentExecutions = useMemo(() => executions.slice(0, 6), [executions]);

  async function updateLifecycle(
    automation: Automation,
    lifecycleStatus: Automation["lifecycleStatus"],
  ) {
    setBusyId(automation.id);
    try {
      const updated = await api<Automation>(
        `/api/automations/${automation.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            lifecycleStatus,
            enabled: lifecycleStatus === "enabled",
          }),
        },
      );
      setAutomations((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      toast.success(
        lifecycleStatus === "enabled"
          ? "Automation activated"
          : lifecycleStatus === "archived"
            ? "Automation archived"
            : "Automation paused",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update automation",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function duplicate(automation: Automation) {
    setBusyId(automation.id);
    try {
      const copy = await api<Automation>("/api/automations", {
        method: "POST",
        body: JSON.stringify({
          name: `${automation.name} copy`,
          agentId: automation.agentId,
          triggerType: automation.triggerType,
          cronExpression: automation.cronExpression,
          scheduleTimezone: automation.scheduleTimezone,
          emailAccountId: automation.emailAccountId,
          emailMatch: automation.emailMatch,
          steps: automation.steps.map((step) => ({
            ...step,
            id: crypto.randomUUID(),
          })),
          prompt: automation.prompt,
          mode: automation.mode,
          lifecycleStatus: "draft",
          enabled: false,
          missedRunPolicy: automation.missedRunPolicy,
        }),
      });
      setAutomations((current) => [...current, copy]);
      toast.success("Draft copy created");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not duplicate automation",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function runTest(automation: Automation) {
    setBusyId(automation.id);
    try {
      await api(`/api/automations/${automation.id}/run`, { method: "POST" });
      toast.success("Test run queued");
      router.push("/runs");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not start test run",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-6 overflow-x-clip">
      <PageHeader
        title="Automations"
        description="Recurring and inbox-triggered operations, with a clear owner and an auditable outcome."
        actions={
          <Button asChild variant="signal">
            <Link href="/automations/new">
              <Plus /> New automation
            </Link>
          </Button>
        }
      />

      <OperationalSummary automations={automations} />

      {initialData.emailError && (
        <div className="flex items-start gap-3 border-l-2 border-amber-600 bg-amber-500/[0.055] px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-800" />
          <div>
            <p className="font-semibold">Inbox automation needs attention</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {initialData.emailError}
            </p>
          </div>
        </div>
      )}

      <section>
        <SectionHeader
          title="Operations"
          meta={
            automations.length
              ? `${automations.length} configured`
              : "No workflows configured yet"
          }
        />
        {automations.length ? (
          <DenseTable minWidth="980px">
            <thead>
              <tr>
                <th className={denseTableHead}>Automation</th>
                <th className={denseTableHead}>Trigger</th>
                <th className={denseTableHead}>Owner</th>
                <th className={denseTableHead}>Status</th>
                <th className={denseTableHead}>Last run</th>
                <th className={denseTableHead}>Next run</th>
                <th className={`${denseTableHead} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {automations.map((automation) => {
                const trigger = triggerSummary(automation);
                const TriggerIcon = trigger.icon;
                const busy = busyId === automation.id;
                return (
                  <tr key={automation.id} className="group hover:bg-muted/25">
                    <td className={denseTableCell}>
                      <Link
                        href={`/automations/${automation.id}`}
                        className="font-[650] hover:underline hover:decoration-accent hover:decoration-2 hover:underline-offset-4"
                      >
                        {automation.name}
                      </Link>
                      <p className="mt-0.5 font-mono text-[0.68rem] text-muted-foreground">
                        v{automation.workflowVersion} ·{" "}
                        {automation.triggerType === "email"
                          ? `${automation.steps.length} ${automation.steps.length === 1 ? "step" : "steps"}`
                          : automation.mode}
                      </p>
                    </td>
                    <td className={denseTableCell}>
                      <div className="flex items-start gap-2">
                        <TriggerIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <div>
                          <p className="text-xs font-semibold">
                            {trigger.title}
                          </p>
                          <p
                            className="mt-0.5 max-w-56 truncate font-mono text-[0.65rem] text-muted-foreground"
                            title={trigger.detail}
                          >
                            {trigger.detail}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className={`${denseTableCell} text-xs`}>
                      {automation.agentName ?? "Unknown"}
                    </td>
                    <td className={denseTableCell}>
                      <StatusBadge status={automationStatus(automation)} />
                    </td>
                    <td
                      className={`${denseTableCell} text-xs text-muted-foreground`}
                    >
                      {automation.lastRunAt ? (
                        automation.lastRunId ? (
                          <Link
                            href={`/runs/${automation.lastRunId}`}
                            className="hover:text-foreground"
                          >
                            {formatRelativePast(automation.lastRunAt)}
                          </Link>
                        ) : (
                          formatRelativePast(automation.lastRunAt)
                        )
                      ) : (
                        "Never"
                      )}
                    </td>
                    <td
                      className={`${denseTableCell} text-xs text-muted-foreground`}
                    >
                      {automation.nextRunAt ? (
                        <span title={formatDateTime(automation.nextRunAt)}>
                          {formatRelativeFuture(automation.nextRunAt)}
                        </span>
                      ) : automation.triggerType === "email" &&
                        automation.enabled ? (
                        "On matching email"
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`${denseTableCell} text-right`}>
                      <div className="flex items-center justify-end gap-1">
                        {automation.triggerType === "schedule" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={
                              busy ||
                              automation.lifecycleStatus === "archived"
                            }
                            onClick={() => runTest(automation)}
                          >
                            <Play /> Run test
                          </Button>
                        ) : (
                          <Button asChild variant="outline" size="sm">
                            <Link
                              href={`/automations/${automation.id}#review-test`}
                            >
                              <Sparkles /> Test match
                            </Link>
                          </Button>
                        )}
                        <Button
                          asChild
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Edit ${automation.name}`}
                        >
                          <Link href={`/automations/${automation.id}`}>
                            <Pencil />
                          </Link>
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`More actions for ${automation.name}`}
                                disabled={busy}
                              />
                            }
                          >
                            <MoreHorizontal />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem
                              onClick={() => duplicate(automation)}
                            >
                              <Copy /> Duplicate as draft
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {automation.lifecycleStatus === "enabled" ? (
                              <DropdownMenuItem
                                onClick={() =>
                                  updateLifecycle(automation, "paused")
                                }
                              >
                                <Pause /> Pause
                              </DropdownMenuItem>
                            ) : automation.lifecycleStatus !== "archived" ? (
                              <DropdownMenuItem
                                onClick={() =>
                                  updateLifecycle(automation, "enabled")
                                }
                              >
                                <RotateCcw /> Activate
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() =>
                                  updateLifecycle(automation, "draft")
                                }
                              >
                                <RotateCcw /> Restore as draft
                              </DropdownMenuItem>
                            )}
                            {automation.lifecycleStatus !== "archived" && (
                              <DropdownMenuItem
                                onClick={() =>
                                  updateLifecycle(automation, "archived")
                                }
                              >
                                <Archive /> Archive
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DenseTable>
        ) : (
          <div className="grid min-h-48 place-items-center border border-dashed px-6 py-10 text-center">
            <div className="max-w-md">
              <Sparkles className="mx-auto size-5 text-muted-foreground" />
              <h2 className="mt-3 text-lg font-[675] tracking-[-0.025em]">
                Put one recurring operation on rails
              </h2>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                Start with a tested template or define a schedule or inbox
                trigger. Nothing runs until you activate it.
              </p>
            </div>
          </div>
        )}
      </section>

      <Templates />

      <section>
        <SectionHeader
          title="Recent inbox workflows"
          meta={
            recentExecutions.length
              ? "Latest event-driven executions"
              : "No inbox events processed yet"
          }
          action={
            <Button asChild variant="ghost" size="sm">
              <Link href="/runs">View all runs</Link>
            </Button>
          }
        />
        {recentExecutions.length > 0 ? (
          <div className="divide-y rounded-lg border bg-card">
            {recentExecutions.map((execution) => {
              const activeStep = execution.steps[execution.currentStepIndex];
              return (
                <div
                  key={execution.id}
                  className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_12rem_8rem] md:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                      <p className="truncate text-sm font-[650]">
                        {execution.automationName}
                      </p>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {execution.event.from.address} ·{" "}
                      {execution.event.subject || "No subject"}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {activeStep?.runId ? (
                      <Link
                        href={`/runs/${activeStep.runId}`}
                        className="hover:text-foreground hover:underline hover:decoration-accent hover:underline-offset-4"
                      >
                        {activeStep.agentName} ·{" "}
                        {activeStep.action.replaceAll("_", " ")}
                      </Link>
                    ) : activeStep ? (
                      `${activeStep.agentName} · ${activeStep.action.replaceAll("_", " ")}`
                    ) : (
                      `${execution.steps.length} ${execution.steps.length === 1 ? "step" : "steps"}`
                    )}
                  </p>
                  <div className="flex items-center justify-between gap-2 md:justify-end">
                    <StatusBadge status={execution.status} />
                    <span className="font-mono text-[0.65rem] text-muted-foreground">
                      {formatRelativePast(execution.createdAt)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="border-t py-4 text-sm text-muted-foreground">
            Inbox-triggered automation activity will appear here after the first
            matching message.
          </p>
        )}
      </section>
    </div>
  );
}
