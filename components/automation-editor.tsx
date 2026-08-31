"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Mail,
  Play,
  Save,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { AutomationFormSection } from "@/components/automation-form-section";
import {
  defaultEmailWorkflowDraft,
  EmailAutomationWorkflowEditor,
  isEmailWorkflowDraftValid,
  type EmailWorkflowDraft,
} from "@/components/email-automation-workflow-editor";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client-api";
import type { AutomationTemplate } from "@/lib/automation-templates";
import type { AutomationWorkflowStep } from "@/lib/automation-workflow";
import type { Agent, Automation, AutomationsData } from "@/lib/types";
import { formatDateTimeInTimeZone } from "@/lib/utils";

type ScheduleKind = "manual" | "daily" | "weekly" | "monthly" | "custom";

type ScheduleDraft = {
  name: string;
  agentId: string;
  mode: Automation["mode"];
  instructions: string;
  kind: ScheduleKind;
  time: string;
  weekday: string;
  monthday: string;
  cronExpression: string;
  timezone: string;
  missedRunPolicy: Automation["missedRunPolicy"];
};

type PreviewResult =
  | { triggerType: "schedule"; nextRuns: string[] }
  | {
      triggerType: "email";
      matched: boolean;
      ruleCount: number;
      steps: Array<{
        id: string;
        position: number;
        action: AutomationWorkflowStep["action"];
        agentId: string;
      }>;
    };

const weekdays = [
  ["1", "Monday"],
  ["2", "Tuesday"],
  ["3", "Wednesday"],
  ["4", "Thursday"],
  ["5", "Friday"],
  ["6", "Saturday"],
  ["0", "Sunday"],
] as const;

function defaultTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function scheduleFromCron(input: {
  cronExpression: string | null;
  timezone: string;
  name: string;
  agentId: string;
  mode: Automation["mode"];
  instructions: string;
  missedRunPolicy: Automation["missedRunPolicy"];
}): ScheduleDraft {
  if (!input.cronExpression) {
    return {
      ...input,
      kind: "manual",
      time: "09:00",
      weekday: "1",
      monthday: "1",
      cronExpression: "",
    };
  }
  const normalizedInput = {
    ...input,
    cronExpression: input.cronExpression,
  };
  const parts = normalizedInput.cronExpression.trim().split(/\s+/);
  const [minute, hour, day, month, weekday] = parts;
  const time =
    minute !== undefined && hour !== undefined
      ? `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`
      : "09:00";
  if (parts.length === 5 && day === "*" && month === "*" && weekday === "*") {
    return {
      ...normalizedInput,
      kind: "daily",
      time,
      weekday: "1",
      monthday: "1",
    };
  }
  if (
    parts.length === 5 &&
    day === "*" &&
    month === "*" &&
    weekday !== undefined &&
    /^\d$/.test(weekday)
  ) {
    return {
      ...normalizedInput,
      kind: "weekly",
      time,
      weekday,
      monthday: "1",
    };
  }
  if (
    parts.length === 5 &&
    day !== undefined &&
    /^\d{1,2}$/.test(day) &&
    month === "*" &&
    weekday === "*"
  ) {
    return {
      ...normalizedInput,
      kind: "monthly",
      time,
      weekday: "1",
      monthday: day,
    };
  }
  return {
    ...normalizedInput,
    kind: "custom",
    time,
    weekday: "1",
    monthday: "1",
  };
}

function cronForSchedule(draft: ScheduleDraft) {
  if (draft.kind === "manual") return null;
  if (draft.kind === "custom") return draft.cronExpression.trim();
  const [hour, minute] = draft.time.split(":");
  if (draft.kind === "daily") return `${minute} ${hour} * * *`;
  if (draft.kind === "weekly") {
    return `${minute} ${hour} * * ${draft.weekday}`;
  }
  return `${minute} ${hour} ${draft.monthday} * *`;
}

function scheduleSummary(draft: ScheduleDraft) {
  if (draft.kind === "manual")
    return "Runs only when you start a test manually.";
  const zone = draft.timezone.replaceAll("_", " ");
  if (draft.kind === "daily") return `Every day at ${draft.time} · ${zone}`;
  if (draft.kind === "weekly") {
    const day = weekdays.find(([value]) => value === draft.weekday)?.[1];
    return `Every ${day} at ${draft.time} · ${zone}`;
  }
  if (draft.kind === "monthly") {
    return `Day ${draft.monthday} of every month at ${draft.time} · ${zone}`;
  }
  return `${draft.cronExpression || "Enter a cron expression"} · ${zone}`;
}

function emailDraftFromInput(input: {
  automation: Automation | null;
  template: AutomationTemplate | null;
  agents: Agent[];
  data: AutomationsData;
}) {
  if (input.automation?.triggerType === "email") {
    return {
      name: input.automation.name,
      emailAccountId: input.automation.emailAccountId ?? "",
      emailMatch: input.automation.emailMatch,
      steps: input.automation.steps,
    } satisfies EmailWorkflowDraft;
  }
  const draft = defaultEmailWorkflowDraft({
    agents: input.agents,
    accounts: input.data.emailAccounts,
    emailAccess: input.data.emailAccess,
  });
  if (input.template?.triggerType !== "email" || !input.template.email) {
    return draft;
  }
  const firstAgentId = draft.steps[0]?.agentId ?? "";
  return {
    ...draft,
    name: input.template.name,
    emailMatch: {
      ...draft.emailMatch,
      subjectIncludes: input.template.email.subjectIncludes ?? null,
    },
    steps: input.template.email.steps.map((step, index) => ({
      id: `template-step-${index + 1}`,
      type: step.action === "review_and_reply" ? "agent_review" : "agent_task",
      agentId: firstAgentId,
      action: step.action,
      prompt: step.prompt,
    })),
  } satisfies EmailWorkflowDraft;
}

export function AutomationEditor({
  automation,
  template,
  data,
}: {
  automation: Automation | null;
  template: AutomationTemplate | null;
  data: AutomationsData;
}) {
  const router = useRouter();
  const agents = data.agents.filter((agent) => agent.enabled);
  const defaultAgentId =
    agents.find((agent) => agent.slug === "coo")?.id ?? agents[0]?.id ?? "";
  const initialTrigger =
    automation?.triggerType ?? template?.triggerType ?? "schedule";
  const [triggerType, setTriggerType] =
    useState<Automation["triggerType"]>(initialTrigger);
  const [lifecycleStatus, setLifecycleStatus] = useState<
    Automation["lifecycleStatus"]
  >(automation?.lifecycleStatus ?? "draft");
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [sample, setSample] = useState({
    senderAddress: "customer@example.com",
    recipientAddress:
      data.emailAccounts[0]?.emailAddress ?? "support@example.com",
    subject: "Help with my account",
  });
  const [emailDraft, setEmailDraft] = useState<EmailWorkflowDraft>(() =>
    emailDraftFromInput({ automation, template, agents, data }),
  );
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>(() =>
    scheduleFromCron({
      name:
        automation?.triggerType === "schedule"
          ? automation.name
          : template?.triggerType === "schedule"
            ? template.name
            : "",
      agentId:
        automation?.triggerType === "schedule"
          ? automation.agentId
          : defaultAgentId,
      mode:
        automation?.triggerType === "schedule"
          ? automation.mode
          : (template?.mode ?? "review"),
      instructions:
        automation?.triggerType === "schedule"
          ? automation.prompt
          : template?.triggerType === "schedule"
            ? template.prompt
            : "",
      cronExpression:
        automation?.triggerType === "schedule"
          ? automation.cronExpression
          : template?.triggerType === "schedule"
            ? template.cronExpression
            : "0 9 * * 1",
      timezone:
        automation?.triggerType === "schedule"
          ? automation.scheduleTimezone
          : defaultTimezone(),
      missedRunPolicy: automation?.missedRunPolicy ?? "latest_once",
    }),
  );

  const selectedAgent = agents.find(({ id }) => id === scheduleDraft.agentId);
  const updateSchedule = (update: Partial<ScheduleDraft>) => {
    setScheduleDraft((current) => ({ ...current, ...update }));
    setPreview(null);
  };

  async function runPreview() {
    setPreviewing(true);
    try {
      const result = await api<PreviewResult>("/api/automations/preview", {
        method: "POST",
        body: JSON.stringify(
          triggerType === "schedule"
            ? {
                triggerType,
                cronExpression: cronForSchedule(scheduleDraft),
                scheduleTimezone: scheduleDraft.timezone,
              }
            : {
                triggerType,
                emailMatch: emailDraft.emailMatch,
                steps: emailDraft.steps,
                sample: {
                  senderAddress: sample.senderAddress,
                  recipientAddresses: [sample.recipientAddress],
                  subject: sample.subject,
                },
              },
        ),
      });
      setPreview(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  }

  async function save(status: Automation["lifecycleStatus"]) {
    const valid =
      triggerType === "schedule"
        ? Boolean(
            scheduleDraft.name.trim() &&
            scheduleDraft.agentId &&
            scheduleDraft.instructions.trim().length >= 2 &&
            (scheduleDraft.kind === "manual" || cronForSchedule(scheduleDraft)),
          )
        : isEmailWorkflowDraftValid(emailDraft);
    if (!valid) {
      toast.error("Complete the required fields before saving.");
      return;
    }
    setSaving(true);
    try {
      const body =
        triggerType === "schedule"
          ? {
              name: scheduleDraft.name,
              agentId: scheduleDraft.agentId,
              triggerType,
              cronExpression: cronForSchedule(scheduleDraft),
              scheduleTimezone: scheduleDraft.timezone,
              emailAccountId: null,
              prompt: scheduleDraft.instructions,
              mode: scheduleDraft.mode,
              lifecycleStatus: status,
              enabled: status === "enabled",
              missedRunPolicy: scheduleDraft.missedRunPolicy,
            }
          : {
              name: emailDraft.name,
              agentId: emailDraft.steps[0]!.agentId,
              triggerType,
              cronExpression: null,
              scheduleTimezone: "UTC",
              emailAccountId: emailDraft.emailAccountId,
              emailMatch: emailDraft.emailMatch,
              steps: emailDraft.steps,
              prompt: emailDraft.steps[0]!.prompt,
              mode: "task" as const,
              lifecycleStatus: status,
              enabled: status === "enabled",
            };
      await api<Automation>(
        automation ? `/api/automations/${automation.id}` : "/api/automations",
        {
          method: automation ? "PATCH" : "POST",
          body: JSON.stringify(
            automation
              ? { ...body, expectedWorkflowVersion: automation.workflowVersion }
              : body,
          ),
        },
      );
      setLifecycleStatus(status);
      toast.success(
        status === "enabled" ? "Automation activated" : "Automation saved",
      );
      router.push("/automations");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save automation",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto min-w-0 max-w-6xl overflow-x-clip">
      <PageHeader
        title={automation ? "Edit automation" : "Create automation"}
        description={
          automation
            ? `Workflow v${automation.workflowVersion} · changes apply to future executions.`
            : "Define the trigger, work and safeguards before anything becomes active."
        }
        actions={
          <Button asChild variant="ghost">
            <Link href="/automations">
              <ArrowLeft /> Back to automations
            </Link>
          </Button>
        }
      />

      {!automation && (
        <AutomationFormSection
          icon={Play}
          title="Trigger"
          description="Choose what starts this automation. The rest of the editor adapts to that event."
        >
          <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2">
            {(
              [
                [
                  "schedule",
                  CalendarClock,
                  "Schedule",
                  "Run at a recurring time or only when tested.",
                ],
                [
                  "email",
                  Mail,
                  "Inbox email",
                  "Start once for each newly received matching message.",
                ],
              ] as const
            ).map(([value, Icon, label, description]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setTriggerType(value);
                  setPreview(null);
                }}
                className={`flex min-h-24 items-start gap-3 bg-background p-4 text-left transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50 ${
                  triggerType === value ? "bg-accent-muted/60" : ""
                }`}
                aria-pressed={triggerType === value}
              >
                <Icon className="mt-0.5 size-4 text-muted-foreground" />
                <span>
                  <span className="block text-sm font-[650]">{label}</span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    {description}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {!data.emailConfigured && (
            <p className="mt-2 text-xs text-muted-foreground">
              Connect Email and grant an agent read access before saving an
              inbox workflow.
            </p>
          )}
        </AutomationFormSection>
      )}

      {triggerType === "schedule" ? (
        <>
          <AutomationFormSection
            icon={Settings2}
            title="Basics"
            description="Name the operation and choose the agent responsible for the outcome."
          >
            <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-xs font-semibold">
                Name
                <Input
                  value={scheduleDraft.name}
                  onChange={(event) =>
                    updateSchedule({ name: event.target.value })
                  }
                  placeholder="Weekly operations review"
                  autoFocus
                />
              </label>
              <label className="grid gap-2 text-xs font-semibold">
                Agent
                <Select
                  value={scheduleDraft.agentId}
                  onValueChange={(agentId) => updateSchedule({ agentId })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {selectedAgent
                        ? `${selectedAgent.name} · ${selectedAgent.role}`
                        : "Choose an agent"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name} · {agent.role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
          </AutomationFormSection>

          <AutomationFormSection
            icon={Clock3}
            title="Schedule"
            description="Use a human schedule first. Raw cron remains available for exceptional cases."
          >
            <div className="grid max-w-3xl gap-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_10rem_1fr]">
                <label className="grid gap-2 text-xs font-semibold">
                  Frequency
                  <Select
                    value={scheduleDraft.kind}
                    onValueChange={(kind) =>
                      updateSchedule({ kind: kind as ScheduleKind })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {scheduleDraft.kind === "manual"
                          ? "Manual only"
                          : scheduleDraft.kind === "custom"
                            ? "Custom cron"
                            : `${scheduleDraft.kind[0]!.toUpperCase()}${scheduleDraft.kind.slice(1)}`}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="manual">Manual only</SelectItem>
                      <SelectItem value="custom">Custom cron</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                {!["manual", "custom"].includes(scheduleDraft.kind) && (
                  <label className="grid gap-2 text-xs font-semibold">
                    Time
                    <Input
                      type="time"
                      value={scheduleDraft.time}
                      onChange={(event) =>
                        updateSchedule({ time: event.target.value })
                      }
                    />
                  </label>
                )}
                {scheduleDraft.kind === "weekly" && (
                  <label className="grid gap-2 text-xs font-semibold">
                    Day
                    <Select
                      value={scheduleDraft.weekday}
                      onValueChange={(weekday) => updateSchedule({ weekday })}
                    >
                      <SelectTrigger>
                        <SelectValue>
                          {weekdays.find(
                            ([value]) => value === scheduleDraft.weekday,
                          )?.[1] ?? "Choose a day"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {weekdays.map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                )}
                {scheduleDraft.kind === "monthly" && (
                  <label className="grid gap-2 text-xs font-semibold">
                    Day of month
                    <Input
                      type="number"
                      min="1"
                      max="28"
                      value={scheduleDraft.monthday}
                      onChange={(event) =>
                        updateSchedule({ monthday: event.target.value })
                      }
                    />
                  </label>
                )}
              </div>
              {scheduleDraft.kind === "custom" && (
                <label className="grid max-w-xl gap-2 text-xs font-semibold">
                  Cron expression
                  <Input
                    className="font-mono"
                    value={scheduleDraft.cronExpression}
                    onChange={(event) =>
                      updateSchedule({ cronExpression: event.target.value })
                    }
                    placeholder="0 9 * * 1"
                  />
                </label>
              )}
              {scheduleDraft.kind !== "manual" && (
                <label className="grid max-w-xl gap-2 text-xs font-semibold">
                  Timezone
                  <Input
                    list="automation-timezones"
                    value={scheduleDraft.timezone}
                    onChange={(event) =>
                      updateSchedule({ timezone: event.target.value })
                    }
                    placeholder="America/Argentina/Buenos_Aires"
                  />
                  <datalist id="automation-timezones">
                    <option value="UTC" />
                    <option value="America/Argentina/Buenos_Aires" />
                    <option value="America/New_York" />
                    <option value="America/Los_Angeles" />
                    <option value="Europe/London" />
                    <option value="Europe/Paris" />
                    <option value="Asia/Tokyo" />
                  </datalist>
                </label>
              )}
              <div className="border-l-2 border-accent pl-3">
                <p className="text-sm font-[650]">
                  {scheduleSummary(scheduleDraft)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Scheduler occurrences are persisted and dispatched once.
                </p>
              </div>
            </div>
          </AutomationFormSection>

          <AutomationFormSection
            icon={Bot}
            title="Agent work"
            description="Define the requested deliverable. Each scheduled run starts with a fresh runtime thread."
          >
            <div className="grid max-w-3xl gap-4">
              <label className="grid max-w-sm gap-2 text-xs font-semibold">
                Outcome
                <Select
                  value={scheduleDraft.mode}
                  onValueChange={(mode) =>
                    updateSchedule({ mode: mode as Automation["mode"] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue>
                      {scheduleDraft.mode === "review"
                        ? "Review and decide"
                        : "Complete a specific task"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="review">Review and decide</SelectItem>
                    <SelectItem value="task">
                      Complete a specific task
                    </SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-2 text-xs font-semibold">
                Instructions
                <Textarea
                  value={scheduleDraft.instructions}
                  onChange={(event) =>
                    updateSchedule({ instructions: event.target.value })
                  }
                  className="min-h-40 resize-y"
                  placeholder="Describe the outcome this automation should produce…"
                />
              </label>
            </div>
          </AutomationFormSection>
        </>
      ) : (
        <EmailAutomationWorkflowEditor
          draft={emailDraft}
          onChange={(draft) => {
            setEmailDraft(draft);
            setPreview(null);
          }}
          agents={agents}
          accounts={data.emailAccounts}
          emailAccess={data.emailAccess}
        />
      )}

      <AutomationFormSection
        icon={ShieldCheck}
        title="Safeguards"
        description="Control activation and recovery without changing agent identity or permissions."
      >
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          {automation && (
            <label className="grid gap-2 text-xs font-semibold">
              Lifecycle
              <Select
                value={lifecycleStatus}
                onValueChange={(value) =>
                  setLifecycleStatus(value as Automation["lifecycleStatus"])
                }
              >
                <SelectTrigger>
                  <SelectValue>
                    {lifecycleStatus === "enabled"
                      ? "Active"
                      : `${lifecycleStatus[0]!.toUpperCase()}${lifecycleStatus.slice(1)}`}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="enabled">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </label>
          )}
          {triggerType === "schedule" ? (
            <label className="grid gap-2 text-xs font-semibold">
              After downtime
              <Select
                value={scheduleDraft.missedRunPolicy}
                onValueChange={(missedRunPolicy) =>
                  updateSchedule({
                    missedRunPolicy:
                      missedRunPolicy as Automation["missedRunPolicy"],
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue>
                    {scheduleDraft.missedRunPolicy === "latest_once"
                      ? "Run the latest missed occurrence once"
                      : "Skip missed occurrences"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest_once">
                    Run the latest missed occurrence once
                  </SelectItem>
                  <SelectItem value="skip">Skip missed occurrences</SelectItem>
                </SelectContent>
              </Select>
            </label>
          ) : (
            <div className="rounded-md bg-muted/45 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
              Each inbound event is deduplicated. A conversation can have only
              one active workflow, and Email send policy still governs replies.
            </div>
          )}
        </div>
      </AutomationFormSection>

      <AutomationFormSection
        id="review-test"
        icon={CheckCircle2}
        title="Review and test"
        description="Evaluate the trigger without launching an agent or changing external systems."
      >
        <div className="grid max-w-3xl gap-4">
          {triggerType === "email" && (
            <div className="grid gap-3 rounded-lg border bg-muted/25 p-4 sm:grid-cols-3">
              <label className="grid gap-2 text-xs font-semibold">
                Sample sender
                <Input
                  type="email"
                  value={sample.senderAddress}
                  onChange={(event) =>
                    setSample({ ...sample, senderAddress: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-2 text-xs font-semibold">
                Sample recipient
                <Input
                  type="email"
                  value={sample.recipientAddress}
                  onChange={(event) =>
                    setSample({
                      ...sample,
                      recipientAddress: event.target.value,
                    })
                  }
                />
              </label>
              <label className="grid gap-2 text-xs font-semibold">
                Sample subject
                <Input
                  value={sample.subject}
                  onChange={(event) =>
                    setSample({ ...sample, subject: event.target.value })
                  }
                />
              </label>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={runPreview}
              disabled={previewing}
            >
              <Play /> {previewing ? "Evaluating…" : "Preview trigger"}
            </Button>
            <p className="text-xs text-muted-foreground">
              No run, tool call or email is created by this preview.
            </p>
          </div>
          {preview?.triggerType === "schedule" && (
            <div className="grid gap-2 border-l-2 border-accent pl-3">
              <p className="text-sm font-[650]">
                {preview.nextRuns.length
                  ? "Next scheduled runs"
                  : "Manual only"}
              </p>
              {preview.nextRuns.map((date) => (
                <p
                  key={date}
                  className="font-mono text-xs text-muted-foreground"
                >
                  {formatDateTimeInTimeZone(date, scheduleDraft.timezone)}
                </p>
              ))}
            </div>
          )}
          {preview?.triggerType === "email" && (
            <div className="flex items-start gap-3 border-l-2 border-accent pl-3">
              <StatusBadge status={preview.matched ? "matched" : "skipped"} />
              <div>
                <p className="text-sm font-[650]">
                  {preview.matched
                    ? `${preview.steps.length} workflow ${preview.steps.length === 1 ? "step would" : "steps would"} run.`
                    : "This sample would not start the workflow."}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {preview.ruleCount
                    ? `${preview.ruleCount} configured matching rules were evaluated.`
                    : "No filters are configured, so every inbound message matches."}
                </p>
              </div>
            </div>
          )}
        </div>
      </AutomationFormSection>

      <div className="sticky bottom-0 z-10 -mx-4 mt-2 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 px-4 py-4 backdrop-blur-sm sm:mx-0">
        <p className="text-xs text-muted-foreground">
          {lifecycleStatus === "enabled"
            ? "Saving will make this automation active."
            : "Draft and paused automations can still be tested manually."}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => save(automation ? lifecycleStatus : "draft")}
          >
            <Save />{" "}
            {saving ? "Saving…" : automation ? "Save changes" : "Save draft"}
          </Button>
          <Button
            type="button"
            variant="signal"
            disabled={saving}
            onClick={() => save("enabled")}
          >
            <Play />{" "}
            {automation?.enabled ? "Save and keep active" : "Save and activate"}
          </Button>
        </div>
      </div>
    </div>
  );
}
