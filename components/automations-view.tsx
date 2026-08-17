"use client";
import { useState } from "react";
import { Clock3, LoaderCircle, Play, Plus, Sparkles, Zap } from "lucide-react";
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
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { api } from "@/lib/client-api";
import type { Agent, Automation, AutomationsData } from "@/lib/types";
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
      await api(`/api/automations/${item.id}/run`, { method: "POST" });
      setAutomations(
        (current) =>
          current?.map((automation) =>
            automation.id === item.id
              ? { ...automation, lastRunAt: new Date().toISOString() }
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
        eyebrow="Local scheduler"
        title="Automations"
        description="Simple cron triggers for repeatable agent work. The scheduler lives with this app and stops when the app stops."
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
          <div className="divide-y border-y">
            {automations.map((item) => (
              <article
                key={item.id}
                className="grid gap-5 py-6 md:grid-cols-[3rem_1fr_13rem_auto] md:items-center"
              >
                <div className="grid size-11 place-items-center rounded-full bg-muted">
                  <Zap className="size-4 text-primary" />
                </div>
                <div>
                  <h2 className="font-heading text-2xl font-semibold">
                    {item.name}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.agentName}
                  </p>
                  <p className="mt-3 line-clamp-2 max-w-2xl text-sm leading-6">
                    {item.prompt}
                  </p>
                </div>
                <div>
                  <p className="flex items-center gap-2 font-mono text-sm">
                    <Clock3 className="size-4" />
                    {item.cronExpression ?? "Manual"}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {item.lastRunAt
                      ? `Last ran ${formatDateTime(item.lastRunAt)}`
                      : "Never run"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
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
              </article>
            ))}
          </div>
        ))}
    </>
  );
}
