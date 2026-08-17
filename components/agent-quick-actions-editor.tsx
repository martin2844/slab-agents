"use client";

import { useState } from "react";
import { ArrowLeft, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
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
import { api } from "@/lib/client-api";
import type { AgentQuickAction } from "@/lib/types";

type EditorState = AgentQuickAction | "new" | null;

export function AgentQuickActionsEditor({
  agentId,
  actions,
  onChange,
}: {
  agentId: string;
  actions: AgentQuickAction[];
  onChange: (actions: AgentQuickAction[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);
  const [saving, setSaving] = useState(false);

  function changeOpen(next: boolean) {
    if (saving) return;
    setOpen(next);
    if (!next) setEditor(null);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !editor) return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const payload = {
      label: String(form.get("label") ?? ""),
      prompt: String(form.get("prompt") ?? ""),
    };
    try {
      const action = await api<AgentQuickAction>(
        editor === "new"
          ? `/api/agents/${agentId}/actions`
          : `/api/agents/${agentId}/actions/${editor.id}`,
        {
          method: editor === "new" ? "POST" : "PATCH",
          body: JSON.stringify(payload),
        },
      );
      onChange(
        editor === "new"
          ? [...actions, action]
          : actions.map((item) => (item.id === action.id ? action : item)),
      );
      toast.success(editor === "new" ? "Quick task added" : "Quick task updated");
      setEditor(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save quick task",
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove(action: AgentQuickAction) {
    if (saving) return;
    setSaving(true);
    try {
      await api(`/api/agents/${agentId}/actions/${action.id}`, {
        method: "DELETE",
      });
      onChange(actions.filter((item) => item.id !== action.id));
      toast.success("Quick task removed");
      setEditor(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not remove quick task",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Pencil />
          Manage tasks
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        {editor ? (
          <form onSubmit={save}>
            <DialogHeader>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mb-2 w-fit"
                onClick={() => setEditor(null)}
                disabled={saving}
              >
                <ArrowLeft />
                All quick tasks
              </Button>
              <DialogTitle className="font-heading text-3xl">
                {editor === "new" ? "Add quick task" : "Edit quick task"}
              </DialogTitle>
              <DialogDescription>
                Save a reusable prompt for work this agent performs often.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-6 grid gap-5">
              <label className="grid gap-2 text-sm font-semibold">
                Label
                <Input
                  name="label"
                  defaultValue={editor === "new" ? "" : editor.label}
                  placeholder="Review pipeline"
                  minLength={2}
                  maxLength={48}
                  required
                  autoFocus
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                Prompt
                <Textarea
                  name="prompt"
                  defaultValue={editor === "new" ? "" : editor.prompt}
                  placeholder="Review the active pipeline, identify stalled opportunities, and propose the next concrete action…"
                  className="h-64 min-h-48 resize-none overflow-y-auto font-mono leading-6 [field-sizing:fixed]"
                  minLength={10}
                  required
                />
              </label>
            </div>
            <DialogFooter className="mt-6 sm:justify-between">
              {editor !== "new" ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => remove(editor)}
                  disabled={saving}
                >
                  <Trash2 />
                  Remove
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" disabled={saving}>
                {saving ? <LoaderCircle className="animate-spin" /> : null}
                {saving ? "Saving…" : "Save quick task"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-heading text-3xl">
                Quick tasks
              </DialogTitle>
              <DialogDescription>
                These prompts appear beside Run now. Run now itself is always
                available and accepts any ad-hoc task.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-5 divide-y border-y">
              {actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className="group flex w-full items-start justify-between gap-4 py-4 text-left"
                  onClick={() => setEditor(action)}
                >
                  <span>
                    <span className="block text-sm font-semibold">
                      {action.label}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                      {action.prompt}
                    </span>
                  </span>
                  <Pencil className="mt-1 size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                </button>
              ))}
              {!actions.length && (
                <p className="py-6 text-sm text-muted-foreground">
                  No reusable tasks yet. Add one for recurring work.
                </p>
              )}
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" onClick={() => setEditor("new")}>
                <Plus />
                Add quick task
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
