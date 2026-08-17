"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CircleDashed,
  LoaderCircle,
  Play,
  PlugZap,
  Settings2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client-api";
import type { Agent, SetupCheck, SetupState, SetupStatus } from "@/lib/types";

const defaultPrompt =
  "Review open work and the relevant company docs. Summarize the highest-priority next actions, blockers, and owners.";

const stateLabel: Record<SetupState, string> = {
  connected: "Connected",
  not_tested: "Not tested",
  failed: "Failed",
  missing_config: "Missing config",
};

function StateIcon({ state }: { state: SetupState }) {
  if (state === "connected") return <Check className="size-3.5" />;
  if (state === "failed") return <X className="size-3.5" />;
  if (state === "missing_config") return <AlertTriangle className="size-3.5" />;
  return <CircleDashed className="size-3.5" />;
}

function CheckRow({ check }: { check: SetupCheck }) {
  return (
    <li className="grid gap-3 border-t py-4 sm:grid-cols-[1fr_auto] sm:items-center">
      <div>
        <p className="text-sm font-semibold">{check.label}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {check.detail}
        </p>
      </div>
      <Badge
        variant={check.state === "failed" ? "destructive" : "outline"}
        className={
          check.state === "connected" ? "bg-emerald-700 text-white" : ""
        }
      >
        <StateIcon state={check.state} />
        {stateLabel[check.state]}
      </Badge>
    </li>
  );
}

export function OverviewKickstart({
  initialSetup,
  agents,
}: {
  initialSetup: SetupStatus;
  agents: Agent[];
}) {
  const router = useRouter();
  const [setup, setSetup] = useState(initialSetup);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [agentId, setAgentId] = useState(
    agents.find((agent) => agent.slug === "coo")?.id ?? agents[0]?.id ?? "coo-default",
  );
  const [prompt, setPrompt] = useState(defaultPrompt);

  async function checkSetup() {
    setChecking(true);
    try {
      const result = await api<SetupStatus>("/api/setup/check", {
        method: "POST",
        body: "{}",
      });
      setSetup(result);
      toast.success(
        result.ready
          ? "Workspace is ready"
          : `${result.connected} of ${result.total} checks passed`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Setup check failed");
    } finally {
      setChecking(false);
    }
  }

  async function runFirstLoop() {
    setRunning(true);
    try {
      const result = await api<{ href: string }>("/api/operating-loop", {
        method: "POST",
        body: JSON.stringify({
          workSource: "slab",
          docsSource: "slab-docs",
          agentId: agentId === "coo-default" ? undefined : agentId,
          prompt,
          title: "First operating loop",
          mode: "review",
        }),
      });
      setOpen(false);
      router.push(result.href);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start loop");
      setRunning(false);
    }
  }

  const trigger = (
    <Button>
      <Play />
      Create operating loop
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <PageHeader
        eyebrow="Control plane"
        title="Local agent control plane"
        description="Connect Slab, Slab Docs, and the local Runner—then give a COO agent its first operational job."
        actions={<DialogTrigger asChild>{trigger}</DialogTrigger>}
      />

      <section className="mb-10 grid border-y lg:grid-cols-[1.2fr_0.8fr]">
        <div className="p-5 sm:p-7 lg:border-r">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.16em] text-primary">
                Setup checklist · {setup.connected}/{setup.total}
              </p>
              <h2 className="mt-2 font-heading text-3xl font-semibold tracking-tight">
                Connect the operating system
              </h2>
            </div>
            <Button variant="outline" onClick={checkSetup} disabled={checking}>
              {checking ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <PlugZap />
              )}
              Run setup check
            </Button>
          </div>
          <ul className="mt-5">
            {setup.checks.map((check) => (
              <CheckRow key={check.service} check={check} />
            ))}
          </ul>
        </div>
        <div className="flex flex-col justify-between bg-muted/35 p-5 sm:p-7">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.16em] text-muted-foreground">
              First outcome
            </p>
            <p className="mt-6 font-heading text-4xl font-semibold leading-tight tracking-tight">
              Turn current work into a short list of next actions.
            </p>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              The loop sends one focused task to COO. It consults Work and Docs
              through server-side tools, then keeps the result in a normal thread.
            </p>
          </div>
          <div className="mt-8 flex flex-wrap gap-2">
            <DialogTrigger asChild>{trigger}</DialogTrigger>
            <Button variant="ghost" onClick={() => router.push("/settings")}>
              <Settings2 />
              Open settings
            </Button>
          </div>
        </div>
      </section>
      <OperatingLoopDialog
        agents={agents}
        agentId={agentId}
        setAgentId={setAgentId}
        prompt={prompt}
        setPrompt={setPrompt}
        running={running}
        onRun={runFirstLoop}
      />
    </Dialog>
  );
}

function OperatingLoopDialog({
  agents,
  agentId,
  setAgentId,
  prompt,
  setPrompt,
  running,
  onRun,
}: {
  agents: Agent[];
  agentId: string;
  setAgentId: (value: string) => void;
  prompt: string;
  setPrompt: (value: string) => void;
  running: boolean;
  onRun: () => void;
}) {
  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="font-heading text-3xl">
          Create operating loop
        </DialogTitle>
        <DialogDescription>
          Choose the sources and operator for one real, traceable first run.
        </DialogDescription>
      </DialogHeader>
      <div className="mt-3 divide-y border-y">
        <div className="grid gap-3 py-5 sm:grid-cols-[2rem_1fr_13rem] sm:items-center">
          <span className="font-mono text-xs text-muted-foreground">01</span>
          <div>
            <p className="text-sm font-semibold">Work source</p>
            <p className="text-xs text-muted-foreground">Operational truth</p>
          </div>
          <Select value="slab" disabled>
            <SelectTrigger><SelectValue>Slab</SelectValue></SelectTrigger>
            <SelectContent><SelectItem value="slab">Slab</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="grid gap-3 py-5 sm:grid-cols-[2rem_1fr_13rem] sm:items-center">
          <span className="font-mono text-xs text-muted-foreground">02</span>
          <div>
            <p className="text-sm font-semibold">Knowledge source</p>
            <p className="text-xs text-muted-foreground">Company context</p>
          </div>
          <Select value="slab-docs" disabled>
            <SelectTrigger><SelectValue>Slab Docs</SelectValue></SelectTrigger>
            <SelectContent><SelectItem value="slab-docs">Slab Docs</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="grid gap-3 py-5 sm:grid-cols-[2rem_1fr_13rem] sm:items-center">
          <span className="font-mono text-xs text-muted-foreground">03</span>
          <div>
            <p className="text-sm font-semibold">Agent</p>
            <p className="text-xs text-muted-foreground">Defaults to COO</p>
          </div>
          <Select value={agentId} onValueChange={setAgentId}>
            <SelectTrigger>
              <SelectValue>
                {agents.find((agent) => agent.id === agentId)?.name ??
                  "COO · create now"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {!agents.length && (
                <SelectItem value="coo-default">COO · create now</SelectItem>
              )}
              {agents.map((agent) => (
                <SelectItem value={agent.id} key={agent.id}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <label className="mt-2 grid gap-2 text-sm font-semibold">
        First task
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          className="min-h-28"
        />
      </label>
      <DialogFooter>
        <Button onClick={onRun} disabled={running || prompt.trim().length < 10}>
          {running ? <LoaderCircle className="animate-spin" /> : <Play />}
          {running ? "Starting loop…" : "Run first loop"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
