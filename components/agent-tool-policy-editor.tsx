"use client";

import { useMemo, useState } from "react";
import {
  Ban,
  Check,
  ChevronDown,
  CircleHelp,
  LoaderCircle,
} from "lucide-react";
import { toast } from "sonner";

import { api, ApiClientError } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import type {
  Agent,
  AgentToolCatalogServer,
  AgentToolPolicy,
  Integration,
  ToolPolicyMode,
} from "@/lib/types";

const modeOptions = [
  { mode: "deny" as const, label: "No access", icon: Ban },
  { mode: "prompt" as const, label: "Ask", icon: CircleHelp },
  { mode: "approve" as const, label: "Allow", icon: Check },
];

function modeForTool(
  policy: AgentToolPolicy | undefined,
  tool: AgentToolCatalogServer["tools"][number],
) {
  const mode =
    policy?.tools[tool.name] ?? policy?.defaultMode ?? tool.legacyMode;
  return mode === "approve" && tool.maximumMode === "prompt" ? "prompt" : mode;
}

export function AgentToolPolicyEditor({
  agent,
  initialPolicies,
  catalog,
  integrations,
  onPolicySaved,
}: {
  agent: Agent;
  initialPolicies: AgentToolPolicy[];
  catalog: AgentToolCatalogServer[];
  integrations: Integration[];
  onPolicySaved?: (policy: AgentToolPolicy) => void;
}) {
  const [policies, setPolicies] = useState(initialPolicies);
  const [savingServer, setSavingServer] = useState<string | null>(null);
  const [openServers, setOpenServers] = useState(
    () => new Set(catalog[0] ? [catalog[0].serverName] : []),
  );
  const visibleServers = useMemo(
    () =>
      catalog.flatMap((server) => {
        if (!server.integrationId) return [server];
        const integration = integrations.find(
          (item) => item.id === server.integrationId,
        );
        const assignedTools = integration?.permissions[agent.id] ?? [];
        if (!assignedTools.length) return [];
        return [
          {
            ...server,
            tools: server.tools.filter((tool) =>
              assignedTools.includes(tool.name),
            ),
          },
        ];
      }),
    [agent.id, catalog, integrations],
  );

  async function changeMode(
    server: AgentToolCatalogServer,
    toolName: string,
    requestedMode: ToolPolicyMode,
  ) {
    if (savingServer) return;
    const tool = server.tools.find((item) => item.name === toolName);
    if (!tool) return;
    const nextMode =
      requestedMode === "approve" && tool.maximumMode === "prompt"
        ? "prompt"
        : requestedMode;
    const currentPolicy = policies.find(
      (policy) => policy.serverName === server.serverName,
    );
    const tools = { ...(currentPolicy?.tools ?? {}) };
    for (const catalogTool of server.tools) {
      tools[catalogTool.name] = modeForTool(currentPolicy, catalogTool);
    }
    tools[toolName] = nextMode;

    const optimistic: AgentToolPolicy = {
      agentId: agent.id,
      serverName: server.serverName,
      defaultMode: "deny",
      tools,
      version: currentPolicy?.version ?? 0,
      createdAt: currentPolicy?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const previous = policies;
    setPolicies((items) => [
      ...items.filter((item) => item.serverName !== server.serverName),
      optimistic,
    ]);
    setSavingServer(server.serverName);
    try {
      const saved = await api<AgentToolPolicy>(
        `/api/agents/${agent.id}/tool-policies`,
        {
          method: "PUT",
          body: JSON.stringify({
            serverName: server.serverName,
            defaultMode: "deny",
            tools,
            expectedVersion: currentPolicy?.version ?? 0,
          }),
        },
      );
      setPolicies((items) => [
        ...items.filter((item) => item.serverName !== server.serverName),
        saved,
      ]);
      onPolicySaved?.(saved);
      toast.success(
        `${tool.label}: ${modeOptions.find(({ mode }) => mode === nextMode)?.label}`,
      );
    } catch (error) {
      setPolicies(previous);
      toast.error(
        error instanceof ApiClientError && error.code === "VERSION_CONFLICT"
          ? "Permissions changed elsewhere. Reload this page before trying again."
          : error instanceof Error
            ? error.message
            : "Could not update tool permission",
      );
    } finally {
      setSavingServer(null);
    }
  }

  return (
    <section className="rounded-lg border bg-card p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">Tool permissions</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
            Decide which actions move freely, pause for approval, or stay out of
            reach. Each new run freezes the policy it starts with.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[0.68rem] font-medium text-muted-foreground">
          {modeOptions.map(({ mode, label, icon: Icon }) => (
            <span key={mode} className="inline-flex items-center gap-1">
              <Icon className="size-3" /> {label}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {visibleServers.map((server) => {
          const policy = policies.find(
            (item) => item.serverName === server.serverName,
          );
          const counts = { deny: 0, prompt: 0, approve: 0 };
          for (const tool of server.tools)
            counts[modeForTool(policy, tool)] += 1;
          const isSaving = savingServer === server.serverName;
          return (
            <details
              key={server.serverName}
              open={openServers.has(server.serverName)}
              onToggle={(event) => {
                const isOpen = event.currentTarget.open;
                setOpenServers((current) => {
                  const next = new Set(current);
                  if (isOpen) next.add(server.serverName);
                  else next.delete(server.serverName);
                  return next;
                });
              }}
              className="group overflow-hidden rounded-md border bg-background"
            >
              <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-3 py-2.5 marker:hidden sm:px-4 [&::-webkit-details-marker]:hidden">
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {server.label}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {server.description}
                  </p>
                </div>
                {isSaving ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <LoaderCircle className="size-3.5 animate-spin" /> Saving
                  </span>
                ) : (
                  <span className="hidden font-mono text-[0.65rem] text-muted-foreground sm:block">
                    {counts.approve} allow · {counts.prompt} ask · {counts.deny}{" "}
                    off
                  </span>
                )}
              </summary>
              <div className="border-t">
                {server.tools.map((tool) => {
                  const selected = modeForTool(policy, tool);
                  return (
                    <div
                      key={tool.name}
                      className="grid gap-3 border-b px-3 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-4"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">{tool.label}</p>
                          <span className="rounded-sm border px-1.5 py-0.5 font-mono text-[0.62rem] uppercase text-muted-foreground">
                            {tool.readOnly ? "Read" : "Write"}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                          {tool.description}
                          {tool.maximumMode === "prompt"
                            ? " Maximum: Ask."
                            : ""}
                        </p>
                      </div>
                      <fieldset className="grid grid-cols-3 rounded-md border bg-muted/40 p-0.5">
                        <legend className="sr-only">
                          {tool.label} permission
                        </legend>
                        {modeOptions.map(({ mode, label, icon: Icon }) => {
                          const capped =
                            mode === "approve" && tool.maximumMode === "prompt";
                          return (
                            <label
                              key={mode}
                              title={
                                capped
                                  ? "Connector policy requires approval"
                                  : `${label}: ${tool.label}`
                              }
                              className={cn(
                                "relative inline-flex min-h-11 items-center justify-center gap-1.5 rounded px-2 text-xs font-semibold transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring has-disabled:cursor-not-allowed has-disabled:opacity-40 sm:min-h-9",
                                selected === mode
                                  ? mode === "deny"
                                    ? "bg-destructive/10 text-destructive shadow-sm"
                                    : mode === "prompt"
                                      ? "bg-amber-100 text-amber-950 shadow-sm dark:bg-amber-950/50 dark:text-amber-100"
                                      : "bg-primary text-primary-foreground shadow-sm"
                                  : "text-muted-foreground hover:bg-background hover:text-foreground",
                              )}
                            >
                              <input
                                type="radio"
                                name={`${server.serverName}:${tool.name}`}
                                value={mode}
                                checked={selected === mode}
                                disabled={Boolean(savingServer) || capped}
                                onChange={() =>
                                  changeMode(server, tool.name, mode)
                                }
                                className="sr-only"
                              />
                              <Icon className="size-3.5" />
                              <span>{label}</span>
                            </label>
                          );
                        })}
                      </fieldset>
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
