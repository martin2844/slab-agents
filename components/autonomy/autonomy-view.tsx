"use client";

import { useState } from "react";
import { Bot, Check, LoaderCircle, Pause, Play, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { SectionHeader } from "@/components/operational-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOperationalPolling } from "@/components/use-operational-polling";
import { LocalTime } from "@/components/coding/coding-ui";
import { api } from "@/lib/client-api";
import {
  AUTONOMY_LEVELS,
  CAPABILITY_INFO,
  CAPABILITY_ORDER,
  CAPABILITY_VALUES,
  DEFAULT_PLANNING_PROMPT,
  LEVEL_INFO,
  LEVEL_PRESETS,
  type AutonomyLevel,
  type AutonomyLimits,
  type Capability,
} from "@/lib/autonomy/policy";
import type { AutonomyOverview } from "@/lib/autonomy/overview";
import { cn } from "@/lib/utils";

const LIMIT_FIELDS: Array<{ key: keyof AutonomyLimits; label: string; suffix: string }> = [
  { key: "planningEveryHours", label: "Planning loop every", suffix: "hours" },
  { key: "digestHour", label: "Daily digest at", suffix: "h (local)" },
  { key: "maxConcurrentRuns", label: "Concurrent runs", suffix: "max" },
  { key: "runTimeLimitMinutes", label: "Run time limit", suffix: "minutes" },
  { key: "maxDelegationDepth", label: "Delegation depth", suffix: "max" },
  { key: "maxAutonomousRunsPerDay", label: "Autonomous runs per day", suffix: "max" },
  { key: "outboundDailyCap", label: "Automatic outbound messages per day", suffix: "max" },
  { key: "approvalRemindMinutes", label: "Remind about approvals after", suffix: "minutes" },
  { key: "approvalDenyHours", label: "Deny approvals after", suffix: "hours" },
  { key: "questionWaitHours", label: "Questions wait", suffix: "hours" },
];

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border bg-card p-4", className)}>{children}</div>;
}

export function AutonomyView({ initialData }: { initialData: AutonomyOverview }) {
  const [data, setData] = useState(initialData);
  const [busy, setBusy] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [link, setLink] = useState<{ code: string; linkUrl: string | null; botUsername: string | null } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [limits, setLimits] = useState<AutonomyLimits>(initialData.policy.limits);
  const [prompt, setPrompt] = useState(initialData.policy.planningPrompt);
  const policy = data.policy;

  useOperationalPolling(async () => {
    setData(await api<AutonomyOverview>("/api/autonomy"));
  }, 5_000);

  async function run(key: string, action: () => Promise<unknown>, success?: string) {
    setBusy(key);
    try {
      const result = await action();
      if (result && typeof result === "object" && "policy" in result) setData(result as AutonomyOverview);
      else setData(await api<AutonomyOverview>("/api/autonomy"));
      if (success) toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  const save = (patch: Record<string, unknown>, success = "Saved") =>
    run("save", () => api<AutonomyOverview>("/api/autonomy", { method: "PUT", body: JSON.stringify(patch) }), success);

  const pendingQuestions = data.questions.filter((item) => item.status === "pending");
  const pendingProposals = data.proposals.filter((item) => item.status === "pending");
  const agentName = (id: string | null) => data.agents.find((agent) => agent.id === id)?.name ?? "Slab";

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Configure"
        title="Autonomy"
        description="How much the agents do on their own, how they reach you on Telegram, and the limits they work within."
        actions={
          policy.paused ? (
            <Button size="sm" onClick={() => void run("pause", () => api("/api/autonomy/resume", { method: "POST" }), "Resumed")} disabled={Boolean(busy)}>
              <Play /> Resume (level {policy.configuredLevel})
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => void run("pause", () => api("/api/autonomy/pause", { method: "POST" }), "Paused: nothing runs on its own")} disabled={Boolean(busy)}>
              <Pause /> Pause everything
            </Button>
          )
        }
      />

      {policy.paused && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          Paused: nothing starts on its own (level 0). Saved level: {policy.configuredLevel} · {LEVEL_INFO[policy.configuredLevel].name}.
        </div>
      )}

      <section>
        <SectionHeader title="Level" meta="A preset for every capability below. Level 1 is Slab without autonomy." />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {AUTONOMY_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void save({ level }, `Level ${level}: ${LEVEL_INFO[level].name}`)}
              className={cn(
                "rounded-xl border bg-card p-4 text-left transition hover:border-accent",
                policy.configuredLevel === level && "border-accent ring-2 ring-accent/30",
              )}
            >
              <p className="font-mono text-xs text-muted-foreground">Level {level}</p>
              <p className="mt-1 text-base font-[650]">{LEVEL_INFO[level].name}</p>
              <p className="mt-2 text-sm text-muted-foreground">{LEVEL_INFO[level].summary}</p>
            </button>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader title="Capabilities" meta="Override any capability. “Level default” follows the level above." />
        <Card className="grid gap-3">
          {CAPABILITY_ORDER.map((capability: Capability) => {
            const info = CAPABILITY_INFO[capability];
            const override = policy.overrides[capability];
            const preset = LEVEL_PRESETS[policy.configuredLevel][capability];
            return (
              <div key={capability} className="grid items-center gap-2 md:grid-cols-[16rem_1fr_14rem]">
                <span className="text-sm font-[600]">{info.label}</span>
                <span className="text-xs text-muted-foreground">{info.description}</span>
                <Select
                  value={override ?? "__default"}
                  onValueChange={(value) => void save({ overrides: { [capability]: value === "__default" ? null : value } })}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default">Level default ({info.values[preset]})</SelectItem>
                    {(CAPABILITY_VALUES[capability] as readonly string[]).map((value) => (
                      <SelectItem key={value} value={value}>
                        {info.values[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">
            Red lines always ask you, at every level: merging, releases, money, mass deletes, integrations, credentials, permissions, budgets, and raising the autonomy level.
          </p>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div>
          <SectionHeader title="Lead agent and planning" meta="The lead agent runs the planning loop and answers free Telegram messages." />
          <Card className="grid gap-3">
            <Select value={policy.leadAgentId ?? "__none"} onValueChange={(value) => void save({ leadAgentId: value === "__none" ? null : value })}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Choose the lead agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">No lead agent</SelectItem>
                {data.agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name} ({agent.slug})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={DEFAULT_PLANNING_PROMPT}
              className="min-h-40 font-mono text-xs"
            />
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => void save({ planningPrompt: prompt })} disabled={Boolean(busy)}>
                Save planning prompt
              </Button>
            </div>
          </Card>
        </div>
        <div>
          <SectionHeader title="Limits" meta="Guards apply when the Guards capability is on (level 2 and up)." />
          <Card className="grid gap-2">
            {LIMIT_FIELDS.map((field) => (
              <label key={field.key} className="grid grid-cols-[1fr_7rem_5rem] items-center gap-2 text-sm">
                <span>{field.label}</span>
                <Input
                  type="number"
                  className="h-8"
                  value={limits[field.key] === null ? "" : String(limits[field.key])}
                  onChange={(event) =>
                    setLimits((current) => ({
                      ...current,
                      [field.key]: event.target.value === "" && field.key === "digestHour" ? null : Number(event.target.value),
                    }))
                  }
                />
                <span className="text-xs text-muted-foreground">{field.suffix}</span>
              </label>
            ))}
            <label className="grid grid-cols-[1fr_12.5rem] items-center gap-2 text-sm">
              <span>Timezone</span>
              <Input className="h-8" value={limits.timezone} onChange={(event) => setLimits((current) => ({ ...current, timezone: event.target.value }))} />
            </label>
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => void save({ limits })} disabled={Boolean(busy)}>
                Save limits
              </Button>
            </div>
          </Card>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div>
          <SectionHeader title="Telegram" meta="Your channel with the team: notices, approvals, questions, and commands." />
          <Card className="grid gap-3 text-sm">
            {data.telegram.configured ? (
              <p>
                Bot <span className="font-mono">@{data.telegram.botUsername}</span> ·{" "}
                {data.telegram.linked ? (
                  <>
                    linked to <span className="font-[600]">{data.telegram.chatName}</span>
                  </>
                ) : (
                  <span className="text-amber-700">not linked yet</span>
                )}
                {data.telegram.lastError && <span className="block text-xs text-destructive">{data.telegram.lastError}</span>}
              </p>
            ) : (
              <p className="text-muted-foreground">
                Create a bot with @BotFather on Telegram, then paste its token here.
              </p>
            )}
            <div className="flex gap-2">
              <Input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={data.telegram.configured ? "New bot token (optional)" : "123456:ABC… bot token"}
              />
              <Button
                size="sm"
                disabled={!token.trim() || Boolean(busy)}
                onClick={() =>
                  void run("telegram", async () => {
                    setLink(await api("/api/autonomy/telegram", { method: "POST", body: JSON.stringify({ token }) }));
                    setToken("");
                  }, "Bot saved. Link your chat.")
                }
              >
                {busy === "telegram" ? <LoaderCircle className="animate-spin" /> : <Send />} Save
              </Button>
            </div>
            {data.telegram.configured && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void run("link", async () => setLink(await api("/api/autonomy/telegram/link", { method: "POST" })))}>
                  {data.telegram.linked ? "Link another chat" : "Get link code"}
                </Button>
                <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => {
                  if (window.confirm("Disconnect Telegram?")) void run("unlink", () => api("/api/autonomy/telegram", { method: "DELETE" }));
                }}>
                  <Trash2 /> Disconnect
                </Button>
              </div>
            )}
            {link && (
              <div className="rounded-md border bg-muted/40 p-3">
                <p>
                  Send <span className="font-mono font-[650]">/start {link.code}</span> to{" "}
                  <span className="font-mono">@{link.botUsername}</span> from your Telegram account within 30 minutes.
                </p>
                {link.linkUrl && (
                  <a className="mt-1 inline-block underline" href={link.linkUrl} target="_blank" rel="noreferrer">
                    Open in Telegram
                  </a>
                )}
              </div>
            )}
          </Card>
        </div>
        <div>
          <SectionHeader title="Agent caps" meta="An agent never goes above its cap, whatever the workspace level." />
          <Card className="grid gap-2">
            {data.agents.map((agent) => (
              <div key={agent.id} className="grid grid-cols-[1fr_11rem] items-center gap-2 text-sm">
                <span className="flex items-center gap-2 truncate">
                  <Bot className="size-4 text-muted-foreground" /> {agent.name}
                  {agent.id === policy.leadAgentId && <span className="text-xs text-muted-foreground">lead</span>}
                </span>
                <Select
                  value={policy.agentCaps[agent.id] === undefined ? "__none" : String(policy.agentCaps[agent.id])}
                  onValueChange={(value) => void save({ agentCaps: { [agent.id]: value === "__none" ? null : Number(value) } })}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">No cap</SelectItem>
                    {AUTONOMY_LEVELS.map((level: AutonomyLevel) => (
                      <SelectItem key={level} value={String(level)}>
                        Up to level {level} · {LEVEL_INFO[level].name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </Card>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div>
          <SectionHeader title="Questions" meta={`${pendingQuestions.length} waiting for you`} />
          <Card className="grid gap-3">
            {data.questions.length === 0 && <p className="text-sm text-muted-foreground">No questions yet.</p>}
            {data.questions.slice(0, 12).map((item) => (
              <div key={item.id} className="grid gap-2 border-b pb-3 text-sm last:border-0 last:pb-0">
                <p className="text-xs text-muted-foreground">
                  {agentName(item.agentId)} · {item.kind === "update" ? "update" : item.status} · <LocalTime value={item.createdAt} />
                </p>
                <p className="whitespace-pre-wrap">{item.question}</p>
                {item.answer && <p className="text-xs">Answer: {item.answer}</p>}
                {item.status === "pending" && (
                  <div className="flex flex-wrap gap-2">
                    {item.options.map((option) => (
                      <Button key={option} size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void run(item.id, () => api(`/api/autonomy/questions/${item.id}`, { method: "POST", body: JSON.stringify({ answer: option }) }), "Answered")}>
                        {option}
                      </Button>
                    ))}
                    <Input
                      className="h-8 min-w-48 flex-1"
                      value={answers[item.id] ?? ""}
                      placeholder="Your answer"
                      onChange={(event) => setAnswers((current) => ({ ...current, [item.id]: event.target.value }))}
                    />
                    <Button size="sm" disabled={!answers[item.id]?.trim() || Boolean(busy)} onClick={() => void run(item.id, () => api(`/api/autonomy/questions/${item.id}`, { method: "POST", body: JSON.stringify({ answer: answers[item.id] }) }), "Answered")}>
                      <Send /> Answer
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </Card>
        </div>
        <div>
          <SectionHeader title="Proposals" meta={`${pendingProposals.length} waiting for you`} />
          <Card className="grid gap-3">
            {data.proposals.length === 0 && <p className="text-sm text-muted-foreground">No proposals yet.</p>}
            {data.proposals.slice(0, 12).map((item) => (
              <div key={item.id} className="grid gap-2 border-b pb-3 text-sm last:border-0 last:pb-0">
                <p className="text-xs text-muted-foreground">
                  {agentName(item.agentId)} · {item.status} · <LocalTime value={item.createdAt} />
                </p>
                <p>{item.summary}</p>
                {item.error && <p className="text-xs text-destructive">{item.error}</p>}
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Details</summary>
                  <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-muted p-2">{JSON.stringify(item.payload, null, 2)}</pre>
                </details>
                {item.status === "pending" && (
                  <div className="flex gap-2">
                    <Button size="sm" disabled={Boolean(busy)} onClick={() => void run(item.id, () => api(`/api/autonomy/proposals/${item.id}`, { method: "POST", body: JSON.stringify({ decision: "approve" }) }), "Applied")}>
                      <Check /> Apply
                    </Button>
                    <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void run(item.id, () => api(`/api/autonomy/proposals/${item.id}`, { method: "POST", body: JSON.stringify({ decision: "reject" }) }), "Rejected")}>
                      <X /> Reject
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </Card>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div>
          <SectionHeader title="Follow-ups" meta={`${data.followups.length} scheduled`} />
          <Card className="grid gap-2">
            {data.followups.length === 0 && <p className="text-sm text-muted-foreground">No follow-ups scheduled.</p>}
            {data.followups.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    {agentName(item.agentId)} · <LocalTime value={item.dueAt} />
                    {item.issueKey ? ` · ${item.issueKey}` : ""}
                  </p>
                  <p className="truncate">{item.note}</p>
                </div>
                <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void run(item.id, () => api(`/api/autonomy/followups/${item.id}`, { method: "DELETE" }), "Cancelled")}>
                  <X />
                </Button>
              </div>
            ))}
          </Card>
        </div>
        <div>
          <SectionHeader title="Activity" meta="Every autonomous decision and every policy change." />
          <Card className="grid max-h-[32rem] gap-1.5 overflow-y-auto">
            {data.events.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
            {data.events.map((event) => (
              <div key={event.id} className="grid grid-cols-[8.5rem_1fr] gap-2 text-xs">
                <span className="text-muted-foreground">
                  <LocalTime value={event.createdAt} />
                </span>
                <span>
                  <span className="font-mono text-muted-foreground">{event.actor}</span> {event.summary}
                </span>
              </div>
            ))}
          </Card>
        </div>
      </section>
    </div>
  );
}
