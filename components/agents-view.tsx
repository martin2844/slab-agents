"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, PackageOpen, Play, Plus } from "lucide-react";
import { AgentChatDialog } from "@/components/agent-chat-dialog";
import { AgentCreateDialog } from "@/components/agent-create-dialog";
import { AgentRunDialog } from "@/components/agent-run-dialog";
import {
  DenseTable,
  denseTableCell,
  denseTableHead,
} from "@/components/operational-ui";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useOperationalPolling } from "@/components/use-operational-polling";
import { api } from "@/lib/client-api";
import type {
  Agent,
  AgentEmailAccess,
  Integration,
  Run,
  RuntimeCatalogItem,
} from "@/lib/types";

function agentState(agent: Agent, runs: Run[]) {
  if (!agent.enabled) return "disabled";
  if (runs.some((run) => run.status === "waiting_approval"))
    return "waiting_approval";
  if (runs.some((run) => run.status === "running")) return "running";
  if (runs.some((run) => run.status === "queued")) return "queued";
  return "idle";
}

function currentWork(runs: Run[]) {
  const active = runs.find((run) =>
    ["running", "waiting_approval", "queued"].includes(run.status),
  );
  if (!active) return null;
  return {
    label:
      active.issueKey ??
      (active.mode === "review"
        ? "Operational review"
        : active.mode.replaceAll("_", " ")),
    mode: active.trigger.replaceAll("_", " "),
  };
}

function capabilityNames(
  agent: Agent,
  integrations: Integration[],
  email: AgentEmailAccess[],
) {
  const names = ["Work", "Docs"];
  for (const integration of integrations) {
    if ((integration.permissions[agent.id] ?? []).length)
      names.push(integration.name);
  }
  if (email.some((access) => access.agentId === agent.id)) names.push("Email");
  return names;
}

export function AgentsView({
  initialAgents,
  initialRuns,
  integrations,
  emailAssignments,
  runtimes,
}: {
  initialAgents: Agent[];
  initialRuns: Run[];
  integrations: Integration[];
  emailAssignments: AgentEmailAccess[];
  runtimes: RuntimeCatalogItem[];
}) {
  const [agents, setAgents] = useState<Agent[] | null>(initialAgents);
  const [runs, setRuns] = useState(initialRuns);
  const [error] = useState("");
  useOperationalPolling(async () => {
    setRuns(await api<Run[]>("/api/agents/activity"));
  });
  const enabled = agents?.filter((agent) => agent.enabled).length ?? 0;
  const running =
    agents?.filter((agent) =>
      ["running", "waiting_approval"].includes(
        agentState(
          agent,
          runs.filter((run) => run.agentId === agent.id),
        ),
      ),
    ).length ?? 0;

  return (
    <>
      <PageHeader
        title="Agents"
        description={`${enabled} enabled · ${running} active · ${runs.filter((run) => run.status === "queued").length} queued`}
        actions={
          <AgentCreateDialog
            runtimes={runtimes}
            onCreated={(agent) =>
              setAgents((current) => [...(current ?? []), agent])
            }
          />
        }
      />
      {error && <ErrorState message={error} />}
      {!agents && !error && <LoadingState />}
      {agents && !agents.length && (
        <EmptyState
          title="No agents yet"
          description="Start with an inspectable Operator Pack for a repeatable outcome, or create an Agent manually."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link href="/packs">
                  <PackageOpen /> Browse Operator Packs
                </Link>
              </Button>
              <AgentCreateDialog
                runtimes={runtimes}
                trigger={
                  <Button variant="outline">
                    <Plus /> New agent
                  </Button>
                }
              />
            </div>
          }
        />
      )}
      {agents && agents.length > 0 && (
        <>
          <div className="hidden lg:block">
            <DenseTable minWidth="980px">
              <thead>
                <tr>
                  <th className={denseTableHead}>Agent</th>
                  <th className={denseTableHead}>State</th>
                  <th className={denseTableHead}>Current work</th>
                  <th className={denseTableHead}>Queue</th>
                  <th className={denseTableHead}>Capabilities</th>
                  <th className={`${denseTableHead} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => {
                  const agentRuns = runs.filter(
                    (run) => run.agentId === agent.id,
                  );
                  const state = agentState(agent, agentRuns);
                  const work = currentWork(agentRuns);
                  const queue = agentRuns.filter(
                    (run) => run.status === "queued",
                  ).length;
                  const capabilities = capabilityNames(
                    agent,
                    integrations,
                    emailAssignments,
                  );
                  return (
                    <tr key={agent.id} className="group hover:bg-muted/25">
                      <td className={denseTableCell}>
                        <Link
                          href={`/agents/${agent.id}`}
                          className="flex min-w-48 items-center gap-3"
                        >
                          <span className="grid size-7 place-items-center rounded-md bg-foreground text-xs font-semibold text-background">
                            {agent.name.slice(0, 1).toUpperCase()}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-semibold">
                              {agent.name}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {agent.role}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className={denseTableCell}>
                        <StatusBadge status={state} />
                      </td>
                      <td className={denseTableCell}>
                        {work ? (
                          <span>
                            <span className="block text-sm font-medium">
                              {work.label}
                            </span>
                            <span className="block text-xs capitalize text-muted-foreground">
                              {work.mode}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className={`${denseTableCell} font-mono text-xs`}>
                        {queue ? `${queue} queued` : "—"}
                      </td>
                      <td className={denseTableCell}>
                        <div className="flex max-w-md flex-wrap gap-1">
                          {capabilities.slice(0, 4).map((name) => (
                            <Badge
                              key={name}
                              variant="outline"
                              className="text-[0.65rem]"
                            >
                              {name}
                            </Badge>
                          ))}
                          {capabilities.length > 4 && (
                            <Badge variant="secondary">
                              +{capabilities.length - 4}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className={`${denseTableCell} text-right`}>
                        <div className="flex justify-end gap-1">
                          <AgentChatDialog
                            agent={agent}
                            label="Chat now"
                            size="sm"
                          />
                          <AgentRunDialog
                            agent={agent}
                            label="Run now"
                            icon={Play}
                            size="sm"
                            variant="outline"
                            defaultMode="review"
                          />
                          <Button asChild size="icon-sm" variant="ghost">
                            <Link
                              href={`/agents/${agent.id}`}
                              aria-label={`Open ${agent.name}`}
                            >
                              <ArrowUpRight />
                            </Link>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DenseTable>
          </div>

          <div className="divide-y rounded-lg border bg-card lg:hidden">
            {agents.map((agent) => {
              const agentRuns = runs.filter((run) => run.agentId === agent.id);
              const state = agentState(agent, agentRuns);
              const work = currentWork(agentRuns);
              const capabilities = capabilityNames(
                agent,
                integrations,
                emailAssignments,
              );
              return (
                <article key={agent.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={`/agents/${agent.id}`}
                      className="flex min-w-0 items-center gap-3"
                    >
                      <span className="grid size-8 place-items-center rounded-md bg-foreground text-sm text-background">
                        {agent.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">
                          {agent.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {agent.role}
                        </span>
                      </span>
                    </Link>
                    <StatusBadge status={state} />
                  </div>
                  <p className="mt-3 text-sm">
                    {work ? `${work.label} · ${work.mode}` : "No current work"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {capabilities.map((name) => (
                      <Badge key={name} variant="outline">
                        {name}
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-4 flex gap-2">
                    <AgentChatDialog agent={agent} label="Chat now" size="sm" />
                    <AgentRunDialog
                      agent={agent}
                      label="Run now"
                      icon={Play}
                      size="sm"
                      defaultMode="review"
                    />
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/agents/${agent.id}`}>
                        Open agent <ArrowUpRight />
                      </Link>
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
