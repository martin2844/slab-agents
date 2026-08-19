"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Clock3,
  LoaderCircle,
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
import type { Agent, Automation, AutomationsData, Run } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
function CreateAutomation({
  agents,
  onCreated,
  template,
}: {
  agents: Agent[];
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
    [scheduleType, setScheduleType] = useState<"cron" | "manual">("cron");
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
          cronExpression: scheduleType === "cron" ? form.get("cron") : null,
          prompt: form.get("prompt"),
          mode,
          enabled,
        }),
      });
      onCreated(result);
      setOpen(false);
      toast.success("Automation scheduled");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create automation",
      );
    } finally {
      setSaving(false);
    }
  }
  const selectedAgent = agents.find((agent) => agent.id === agentId);
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
              Schedule an agent
            </DialogTitle>
            <DialogDescription>
              Schedules run only while this local Next.js application is
              running.
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
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} · {a.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <label className="grid gap-2 text-sm font-semibold">
              Trigger
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
            {scheduleType === "cron" && (
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
                placeholder="Review the B2B pipeline and flag every blocked opportunity…"
                defaultValue={template?.prompt}
                className="min-h-36"
                required
              />
            </label>
            <div className="flex items-center justify-between border-y py-4">
              <div>
                <p className="text-sm font-semibold">Enabled</p>
                <p className="text-xs text-muted-foreground">
                  Start checking this schedule immediately.
                </p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </div>
          <DialogFooter className="mt-6">
            <Button type="submit" disabled={saving || !agentId}>
              {saving ? "Scheduling…" : "Create automation"}
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
        description={`${automations?.filter((item) => item.enabled).length ?? 0} active · ${automations?.length ?? 0} configured · local scheduler`}
        actions={
          <CreateAutomation
            agents={agents}
            onCreated={(a) => setAutomations((v) => [...(v ?? []), a])}
          />
        }
      />
      {error && <ErrorState message={error} />}{" "}
      {!automations && !error && <LoadingState />}
      {automations &&
        (!automations.length ? (
          <EmptyState
            title="Nothing scheduled"
            description={
              agents.length
                ? "Create a cron automation for a recurring review, summary, or follow-up."
                : "Create an agent first, then return here to schedule recurring work."
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <CreateAutomation
                  agents={agents}
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
                  onCreated={(a) => setAutomations([a])}
                />
              </div>
            }
          />
        ) : (
          <DenseTable minWidth="980px">
            <thead>
              <tr>
                <th className={denseTableHead}>Automation</th>
                <th className={denseTableHead}>Agent</th>
                <th className={denseTableHead}>Mode</th>
                <th className={denseTableHead}>Schedule</th>
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
                  <td className={`${denseTableCell} font-mono text-xs`}>
                    <span className="flex items-center gap-1.5">
                      <Clock3 className="size-3.5" />
                      {item.cronExpression ?? "Manual"}
                    </span>
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
