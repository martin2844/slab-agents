"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Play,
  Power,
  Sparkles,
} from "lucide-react";
import { AgentCreateDialog } from "@/components/agent-create-dialog";
import { AgentRunDialog } from "@/components/agent-run-dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Agent, AgentQuickAction } from "@/lib/types";
export function AgentsView({
  initialAgents,
  initialQuickActions,
}: {
  initialAgents: Agent[];
  initialQuickActions: AgentQuickAction[];
}) {
  const [agents, setAgents] = useState<Agent[] | null>(initialAgents),
    [error] = useState("");
  return (
    <>
      <PageHeader
        eyebrow="People, but software"
        title="Agents"
        description="Reusable operator definitions that wake up for a conversation or scheduled job."
        actions={
          <AgentCreateDialog
            onCreated={(a) => setAgents((v) => [...(v ?? []), a])}
          />
        }
      />
      {error && <ErrorState message={error} />}{" "}
      {!agents && !error && <LoadingState />}
      {agents &&
        (!agents.length ? (
          <EmptyState
            title="Create your first operator"
            description="Start with a COO who can read Work and Docs, then open a thread to give it a concrete job."
            action={<AgentCreateDialog />}
          />
        ) : (
          <div className="divide-y border-y">
            {agents.map((agent, index) => (
              <article
                key={agent.id}
                className="py-6"
              >
                <div className="grid gap-5 sm:grid-cols-[4rem_1fr_auto] sm:items-center">
                  <Link href={`/agents/${agent.id}`} aria-label={`Open ${agent.name}`}>
                    <div className="grid size-14 place-items-center rounded-full bg-foreground font-heading text-2xl text-background">
                      {agent.name.slice(0, 1).toUpperCase()}
                    </div>
                  </Link>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold tabular-nums text-muted-foreground">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <Link href={`/agents/${agent.id}`} className="group">
                        <h2 className="font-heading text-3xl font-semibold tracking-tight group-hover:text-primary">
                          {agent.name}
                        </h2>
                      </Link>
                      <Badge
                        variant="outline"
                        className={agent.enabled ? "" : "opacity-50"}
                      >
                        <Power className="size-3" />
                        {agent.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm font-semibold">{agent.role}</p>
                    <p className="mt-2 line-clamp-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                      {agent.instructions}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" asChild>
                    <Link href={`/agents/${agent.id}`} aria-label={`Open ${agent.name}`}>
                      <ArrowUpRight className="size-5" />
                    </Link>
                  </Button>
                </div>
                <div className="mt-5 flex flex-wrap gap-2 sm:ml-[5.25rem]">
                  {[
                    {
                      id: `${agent.id}-run-now`,
                      label: "Run now",
                      icon: Play,
                      prompt: "",
                    },
                    ...initialQuickActions
                      .filter((action) => action.agentId === agent.id)
                      .map((action) => ({
                        ...action,
                        icon: Sparkles,
                      })),
                  ].map((item) => (
                      <AgentRunDialog
                        key={item.id}
                        agent={agent}
                        label={item.label}
                        icon={item.icon}
                        defaultPrompt={item.prompt}
                        size="sm"
                        variant={item.label === "Run now" ? "default" : "outline"}
                      />
                  ))}
                </div>
              </article>
            ))}
          </div>
        ))}
    </>
  );
}
