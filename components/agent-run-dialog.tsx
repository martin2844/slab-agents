"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { LoaderCircle, Sparkles } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client-api";
import type { Agent } from "@/lib/types";
import type { AutomationMode } from "@/lib/run-execution";

export function AgentRunDialog({
  agent,
  label,
  icon: Icon,
  defaultPrompt = "",
  variant = "outline",
  size = "default",
  defaultMode = "task",
}: {
  agent: Agent;
  label: string;
  icon: LucideIcon;
  defaultPrompt?: string;
  variant?: "default" | "outline";
  size?: "default" | "sm";
  defaultMode?: AutomationMode;
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [allowWorkCreation, setAllowWorkCreation] = useState(true);
  const [mode, setMode] = useState<AutomationMode>(defaultMode);
  const [running, setRunning] = useState(false);

  function changeOpen(next: boolean) {
    if (running) return;
    setOpen(next);
    if (next) {
      setPrompt(defaultPrompt);
      setAllowWorkCreation(true);
      setMode(defaultMode);
    }
  }

  async function run(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = prompt.trim();
    if (!message || running) return;
    const executionPrompt = allowWorkCreation
      ? `${message}\n\nIf this objective requires Slab work items that do not exist, create only the minimum necessary items and summarize what you created. Do not create filler work.`
      : message;
    setRunning(true);
    try {
      const title =
        label === "Run now" || label === "Give task"
          ? message.replace(/\s+/g, " ").slice(0, 100)
          : label;
      const result = await api<{ href: string }>("/api/operating-loop", {
        method: "POST",
        body: JSON.stringify({
          workSource: "slab",
          docsSource: "slab-docs",
          agentId: agent.id,
          prompt: executionPrompt,
          title,
          mode,
        }),
      });
      window.location.assign(result.href);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not start run",
      );
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} disabled={!agent.enabled}>
          <Icon />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-hidden sm:max-w-xl">
        <form
          onSubmit={run}
          className="flex min-h-0 max-h-[calc(100dvh-4rem)] flex-col"
        >
          <DialogHeader className="shrink-0">
            <DialogTitle className="font-heading text-3xl">
              Run {agent.name}
            </DialogTitle>
            <DialogDescription>
              Give the agent an outcome. Work and Docs are available tools, not
              prerequisites for starting a run.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-6 min-h-0 flex-1 overflow-y-auto pr-1">
            <label className="mb-4 grid gap-2 text-sm font-semibold">
              Execution mode
              <Select
                value={mode}
                onValueChange={(value) => setMode(value as AutomationMode)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="review">Operational review</SelectItem>
                  <SelectItem value="task">Specific task</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs font-normal leading-5 text-muted-foreground">
                {mode === "review"
                  ? "Starts without an associated Work item and reviews the broader operating state."
                  : "Executes the requested outcome without inheriting an arbitrary Work item."}
              </span>
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Prompt
              <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={`What should ${agent.name} move forward?`}
                className="h-56 min-h-40 max-h-56 resize-none overflow-y-auto font-mono leading-6 [field-sizing:fixed]"
                autoFocus
                minLength={10}
                required
              />
            </label>
            <label className="mt-4 flex cursor-pointer gap-3 border-l-2 border-primary bg-muted/50 p-4 text-sm leading-6 text-muted-foreground">
              <Sparkles className="mt-1 size-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-foreground">
                  Create missing Work when needed
                </span>
                The run can start with an empty board. The agent will create
                only the minimum Slab items required by the objective.
              </span>
              <Switch
                checked={allowWorkCreation}
                onCheckedChange={setAllowWorkCreation}
                aria-label="Allow agent to create missing Work items"
              />
            </label>
          </div>
          <DialogFooter className="mt-6 shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={running}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={prompt.trim().length < 10 || running}
            >
              {running ? <LoaderCircle className="animate-spin" /> : <Icon />}
              {running ? "Starting…" : "Start run"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
