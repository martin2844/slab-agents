"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client-api";
import type { Agent, Thread } from "@/lib/types";

export function AgentChatDialog({
  agent,
  label = "Chat now",
  variant = "outline",
  size = "default",
}: {
  agent: Agent;
  label?: string;
  variant?: "default" | "outline";
  size?: "default" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  function changeOpen(next: boolean) {
    if (creating) return;
    setOpen(next);
  }

  async function createThread(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    const form = new FormData(event.currentTarget);
    try {
      const thread = await api<Thread>("/api/threads", {
        method: "POST",
        body: JSON.stringify({
          agentId: agent.id,
          title: form.get("title"),
        }),
      });
      window.location.assign(
        new URL(
          `/agents/${agent.id}/threads/${thread.id}`,
          window.location.origin,
        ).href,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create thread",
      );
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button
          variant={variant}
          size={size}
          disabled={!agent.enabled}
          aria-label={`${label} with ${agent.name}`}
        >
          <MessageSquare />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={createThread}>
          <DialogHeader>
            <DialogTitle className="font-heading text-3xl">
              Chat with {agent.name}
            </DialogTitle>
          </DialogHeader>
          <label className="mt-6 grid gap-2 text-sm font-semibold">
            Conversation title
            <Input
              name="title"
              defaultValue="General"
              autoFocus
              required
            />
          </label>
          <DialogFooter className="mt-6">
            <Button type="submit" disabled={creating}>
              <MessageSquare />
              {creating ? "Opening…" : "Start chat"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
