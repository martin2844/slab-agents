"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Plus } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/client-api";
import type { Agent, RuntimeCatalogItem } from "@/lib/types";

export function AgentCreateDialog({
  onCreated,
  trigger,
  runtimes,
}: {
  onCreated?: (agent: Agent) => void;
  trigger?: React.ReactElement;
  runtimes: RuntimeCatalogItem[];
}) {
  const availableRuntimes = runtimes.filter(
    (runtime) =>
      runtime.enabled && runtime.registered && runtime.health === "available",
  );
  const initialRuntime =
    availableRuntimes.find(({ id }) => id === "codex")?.id ??
    availableRuntimes[0]?.id ??
    "codex";
  const router = useRouter(),
    [open, setOpen] = useState(false),
    [saving, setSaving] = useState(false),
    [enabled, setEnabled] = useState(true),
    [fullAccess, setFullAccess] = useState(false),
    [runtime, setRuntime] = useState(initialRuntime),
    [model, setModel] = useState("default");
  const runtimeModels = runtimes.find(({ id }) => id === runtime)?.models ?? [
    "default",
  ];
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      const agent = await api<Agent>("/api/agents", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          role: form.get("role"),
          instructions: form.get("instructions"),
          runtime,
          model,
          enabled,
          fullAccess,
        }),
      });
      toast.success(`${agent.name} is ready`);
      setOpen(false);
      onCreated?.(agent);
      router.push(`/agents/${agent.id}`);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create agent",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger render={trigger} />
      ) : (
        <DialogTrigger render={<Button />}>
          <Plus />
          New agent
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="font-heading text-3xl">
              Create an agent
            </DialogTitle>
            <DialogDescription>
              Define a reusable identity. A process starts only when this agent
              receives work.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-6 grid gap-5">
            <label className="grid gap-2 text-sm font-semibold">
              Name
              <Input name="name" placeholder="COO" required autoFocus />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Role
              <Input
                name="role"
                placeholder="Chief Operating Officer"
                required
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Instructions
              <Textarea
                name="instructions"
                placeholder="Own the operating cadence, surface blockers, and keep work moving…"
                className="min-h-36"
                required
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold">
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
                    {availableRuntimes.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                Model
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {runtimeModels.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item === "default" ? "Workspace default" : item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
            <div className="divide-y border-y">
              <div className="flex items-center justify-between gap-5 py-4">
                <div>
                  <p className="text-sm font-semibold">Enabled</p>
                  <p className="text-xs text-muted-foreground">
                    Can receive messages and scheduled work.
                  </p>
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={setEnabled}
                  aria-label="Enable agent"
                />
              </div>
              <div className="flex items-center justify-between gap-5 py-4">
                <div>
                  <p className="text-sm font-semibold">
                    Full access to Work and Docs
                  </p>
                  <p className="max-w-md text-xs leading-5 text-muted-foreground">
                    Auto-approve create, update, archive, and delete actions in
                    the configured MCP services. Runtime commands still require
                    approval.
                  </p>
                </div>
                <Switch
                  checked={fullAccess}
                  onCheckedChange={setFullAccess}
                  aria-label="Give agent full access to Work and Docs"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Bot className="size-4" />
              Initial tools: Work and Docs · Refine every action after creation
            </div>
          </div>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create agent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
