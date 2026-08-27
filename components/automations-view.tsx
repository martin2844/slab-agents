"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Clock3,
  LoaderCircle,
  Mail,
  Play,
  Plus,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import {
  DenseTable,
  denseTableCell,
  denseTableHead,
} from "@/components/operational-ui";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { api } from "@/lib/client-api";
import type {
  Agent,
  Automation,
  AutomationsData,
  EmailAccount,
  Run,
} from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
function CreateAutomation({
  agents,
  emailAccounts,
  emailAccess,
  emailConfigured,
  onCreated,
  template,
}: {
  agents: Agent[];
  emailAccounts: EmailAccount[];
  emailAccess: AutomationsData["emailAccess"];
  emailConfigured: boolean;
  onCreated: (a: Automation) => void;
  template?: { name: string; cron: string; prompt: string };
}) {
  const [open, setOpen] = useState(false),
    [agentId, setAgentId] = useState(
      agents.find((agent) => agent.slug === "coo")?.id ?? agents[0]?.id ?? "",
    ),
    [saving, setSaving] = useState(false),
    [enabled, setEnabled] = useState(true),
    [mode, setMode] = useState<Automation["mode"]>("review"),
    [triggerType, setTriggerType] =
      useState<Automation["triggerType"]>("schedule"),
    [emailAccountId, setEmailAccountId] = useState(emailAccounts[0]?.id ?? ""),
    [scheduleType, setScheduleType] = useState<"cron" | "manual">("cron");
  const eligibleEmailAgents = agents.filter((agent) =>
    emailAccess.some(
      (access) =>
        access.agentId === agent.id &&
        access.readEnabled &&
        access.accountIds.includes(emailAccountId),
    ),
  );
  const availableAgents =
    triggerType === "email" ? eligibleEmailAgents : agents;
  const selectTrigger = (value: Automation["triggerType"]) => {
    setTriggerType(value);
    const choices = value === "email" ? eligibleEmailAgents : agents;
    if (!choices.some((agent) => agent.id === agentId)) {
      setAgentId(choices[0]?.id ?? "");
    }
  };
  const selectEmailAccount = (value: string) => {
    setEmailAccountId(value);
    const choices = agents.filter((agent) =>
      emailAccess.some(
        (access) =>
          access.agentId === agent.id &&
          access.readEnabled &&
          access.accountIds.includes(value),
      ),
    );
    if (!choices.some((agent) => agent.id === agentId)) {
      setAgentId(choices[0]?.id ?? "");
    }
  };
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const form = new FormData(e.currentTarget);
    try {
      const result = await api<Automation>("/api/automations", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          agentId,
          triggerType,
          cronExpression:
            triggerType === "schedule" && scheduleType === "cron"
              ? form.get("cron")
              : null,
          emailAccountId: triggerType === "email" ? emailAccountId : null,
          prompt: form.get("prompt"),
          mode,
          enabled,
        }),
      });
      onCreated(result);
      setOpen(false);
      toast.success(
        triggerType === "email"
          ? "Email automation created"
          : "Automation scheduled",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create automation",
      );
    } finally {
      setSaving(false);
    }
  }
  const selectedAgent = availableAgents.find((agent) => agent.id === agentId);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={template ? "outline" : "default"}
          disabled={!agents.length}
        >
          {template ? <Sparkles /> : <Plus />}
          {template ? template.name : "New automation"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="font-heading text-3xl">
              Create an automation
            </DialogTitle>
            <DialogDescription>
              Turn a schedule or a newly received email into a focused agent
              run.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-6 grid gap-5">
            <label className="grid gap-2 text-sm font-semibold">
              Name
              <Input
                name="name"
                placeholder="Monday pipeline review"
                defaultValue={template?.name}
                required
                autoFocus
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Trigger
              <Select
                value={triggerType}
                onValueChange={(value) =>
                  selectTrigger(value as Automation["triggerType"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="schedule">Schedule or manual</SelectItem>
                  <SelectItem
                    value="email"
                    disabled={!emailConfigured || !emailAccounts.length}
                  >
                    Incoming email
                  </SelectItem>
                </SelectContent>
              </Select>
              {!emailConfigured && (
                <span className="text-xs font-normal text-muted-foreground">
                  Connect the Email service in Integrations to use inbox
                  triggers.
                </span>
              )}
            </label>
            {triggerType === "email" && (
              <label className="grid gap-2 text-sm font-semibold">
                Receiving account
                <Select
                  value={emailAccountId}
                  onValueChange={selectEmailAccount}
                  required
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an Email account" />
                  </SelectTrigger>
                  <SelectContent>
                    {emailAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.displayName} · {account.emailAddress}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs font-normal text-muted-foreground">
                  Every newly discovered inbound message creates one durable
                  run. Existing mailbox history is ignored.
                </span>
              </label>
            )}
            <label className="grid gap-2 text-sm font-semibold">
              Agent
              <Select value={agentId} onValueChange={setAgentId} required>
                <SelectTrigger>
                  <SelectValue>
                    {selectedAgent
                      ? `${selectedAgent.name} · ${selectedAgent.role}`
                      : "Choose an agent"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {availableAgents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} · {a.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {triggerType === "email" && !availableAgents.length && (
                <span className="text-xs font-normal text-destructive">
                  No agent can read this account. Assign Email read access on an
                  agent first.
                </span>
              )}
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Execution mode
              <Select
                value={mode}
                onValueChange={(value) => setMode(value as Automation["mode"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="review">Operational review</SelectItem>
                  <SelectItem value="task">Specific task</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs font-normal text-muted-foreground">
                Review starts without an associated Work item. Task follows the
                prompt as a specific outcome.
              </span>
            </label>
            {triggerType === "schedule" && (
              <label className="grid gap-2 text-sm font-semibold">
                Timing
                <Select
                  value={scheduleType}
                  onValueChange={(value) =>
                    setScheduleType(value as "cron" | "manual")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cron">Cron schedule</SelectItem>
                    <SelectItem value="manual">Manual only</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            )}
            {triggerType === "schedule" && scheduleType === "cron" && (
              <label className="grid gap-2 text-sm font-semibold">
                Cron expression
                <Input
                  name="cron"
                  placeholder="0 9 * * 1"
                  defaultValue={template?.cron}
                  required
                />
                <span className="text-xs font-normal text-muted-foreground">
                  Uses the computer’s local timezone.
                </span>
              </label>
            )}
            <label className="grid gap-2 text-sm font-semibold">
              Prompt
              <Textarea
                name="prompt"
                placeholder={
                  triggerType === "email"
                    ? "Read the message, classify the request, and take the appropriate next action…"
                    : "Review the B2B pipeline and flag every blocked opportunity…"
                }
                defaultValue={template?.prompt}
                className="min-h-36"
                required
              />
            </label>
            <div className="flex items-center justify-between border-y py-4">
              <div>
                <p className="text-sm font-semibold">Enabled</p>
                <p className="text-xs text-muted-foreground">
                  {triggerType === "email"
                    ? "Start listening for new messages immediately."
                    : "Start checking this schedule immediately."}
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                aria-label="Enable automation"
              />
            </div>
          </div>
          <DialogFooter className="mt-6">
            <Button
              type="submit"
              disabled={
                saving ||
                !agentId ||
                (triggerType === "email" && !emailAccountId)
              }
            >
              {saving ? "Creating…" : "Create automation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function AutomationsView({
  initialData,
}: {
  initialData: AutomationsData;
}) {
  const [automations, setAutomations] = useState<Automation[] | null>(
      initialData.automations,
    ),
    [agents] = useState<Agent[]>(initialData.agents),
    [error] = useState(""),
    [runningId, setRunningId] = useState<string | null>(null);
  const accountById = new Map(
    initialData.emailAccounts.map((account) => [account.id, account]),
  );
  async function toggle(item: Automation, enabled: boolean) {
    setAutomations(
      (v) => v?.map((a) => (a.id === item.id ? { ...a, enabled } : a)) ?? null,
    );
    try {
      await api(`/api/automations/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
    } catch (e) {
      setAutomations(
        (v) => v?.map((a) => (a.id === item.id ? item : a)) ?? null,
      );
      toast.error(
        e instanceof Error ? e.message : "Could not update automation",
      );
    }
  }
  async function runNow(item: Automation) {
    setRunningId(item.id);
    try {
      const run = await api<Run>(`/api/automations/${item.id}/run`, {
        method: "POST",
      });
      setAutomations(
        (current) =>
          current?.map((automation) =>
            automation.id === item.id
              ? {
                  ...automation,
                  lastRunAt: new Date().toISOString(),
                  lastRunId: run.id,
                }
              : automation,
          ) ?? null,
      );
      toast.success(`${item.name} queued`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Run failed");
    } finally {
      setRunningId(null);
    }
  }
  return (
    <>
      <PageHeader
        title="Automations"
        description={`${automations?.filter((item) => item.enabled).length ?? 0} active · ${automations?.filter((item) => item.triggerType === "email").length ?? 0} inbox-triggered · ${automations?.filter((item) => item.triggerType === "schedule").length ?? 0} scheduled`}
        actions={
          <CreateAutomation
            agents={agents}
            emailAccounts={initialData.emailAccounts}
            emailAccess={initialData.emailAccess}
            emailConfigured={initialData.emailConfigured}
            onCreated={(a) => setAutomations((v) => [...(v ?? []), a])}
          />
        }
      />
      {initialData.emailError && (
        <div
          role="status"
          className="mb-6 flex items-start gap-3 border-y border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm"
        >
          <Mail className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" />
          <div>
            <p className="font-semibold">Inbox triggers need attention</p>
            <p className="mt-0.5 text-muted-foreground">
              {initialData.emailError}
            </p>
          </div>
        </div>
      )}
      {error && <ErrorState message={error} />}{" "}
      {!automations && !error && <LoadingState />}
      {automations &&
        (!automations.length ? (
          <EmptyState
            title="No automations yet"
            description={
              agents.length
                ? "Turn a recurring schedule or a newly received email into focused agent work."
                : "Create an agent first, then return here to automate recurring or inbox-driven work."
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <CreateAutomation
                  agents={agents}
                  emailAccounts={initialData.emailAccounts}
                  emailAccess={initialData.emailAccess}
                  emailConfigured={initialData.emailConfigured}
                  template={{
                    name: "Weekly OKR review",
                    cron: "0 9 * * 1",
                    prompt:
                      "Review current OKRs against open Work and supporting Docs. Summarize progress, risks, blocked outcomes, and the next action for each owner.",
                  }}
                  onCreated={(a) => setAutomations([a])}
                />
                <CreateAutomation
                  agents={agents}
                  emailAccounts={initialData.emailAccounts}
                  emailAccess={initialData.emailAccess}
                  emailConfigured={initialData.emailConfigured}
                  onCreated={(a) => setAutomations([a])}
                />
              </div>
            }
          />
        ) : (
          <DenseTable minWidth="1040px">
            <thead>
              <tr>
                <th className={denseTableHead}>Automation</th>
                <th className={denseTableHead}>Agent</th>
                <th className={denseTableHead}>Mode</th>
                <th className={denseTableHead}>Trigger</th>
                <th className={denseTableHead}>Last run</th>
                <th className={denseTableHead}>Status</th>
                <th className={`${denseTableHead} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {automations.map((item) => (
                <tr key={item.id} className="hover:bg-muted/25">
                  <td className={denseTableCell}>
                    <div className="max-w-sm">
                      <p className="truncate font-semibold">{item.name}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {item.prompt}
                      </p>
                    </div>
                  </td>
                  <td className={`${denseTableCell} font-medium`}>
                    {item.agentName}
                  </td>
                  <td className={`${denseTableCell} text-xs capitalize`}>
                    {item.mode}
                  </td>
                  <td className={`${denseTableCell} text-xs`}>
                    {item.triggerType === "email" ? (
                      <span className="flex max-w-56 items-center gap-1.5">
                        <Mail className="size-3.5 shrink-0" />
                        <span className="truncate">
                          {accountById.get(item.emailAccountId ?? "")
                            ?.emailAddress ?? "Unavailable account"}
                        </span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 font-mono">
                        <Clock3 className="size-3.5" />
                        {item.cronExpression ?? "Manual"}
                      </span>
                    )}
                  </td>
                  <td
                    className={`${denseTableCell} text-xs text-muted-foreground`}
                  >
                    {item.lastRunAt && item.lastRunId ? (
                      <Link
                        href={`/runs/${item.lastRunId}`}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        {formatDateTime(item.lastRunAt)}
                        <ArrowUpRight className="size-3" />
                      </Link>
                    ) : item.lastRunAt ? (
                      formatDateTime(item.lastRunAt)
                    ) : (
                      "Never"
                    )}
                  </td>
                  <td className={denseTableCell}>
                    <StatusBadge
                      status={item.enabled ? "enabled" : "disabled"}
                    />
                  </td>
                  <td className={`${denseTableCell} text-right`}>
                    <div className="flex items-center justify-end gap-2">
                      {item.triggerType === "schedule" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => runNow(item)}
                          disabled={runningId === item.id}
                        >
                          {runningId === item.id ? (
                            <LoaderCircle className="animate-spin" />
                          ) : (
                            <Play />
                          )}
                          Run now
                        </Button>
                      )}
                      <Switch
                        checked={item.enabled}
                        onCheckedChange={(value) => toggle(item, value)}
                        aria-label={`${item.enabled ? "Disable" : "Enable"} ${item.name}`}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </DenseTable>
        ))}
    </>
  );
}
