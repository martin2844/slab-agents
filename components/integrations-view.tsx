"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import {
  Check,
  CircleAlert,
  Clock3,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  PlugZap,
  Puzzle,
  RefreshCw,
  ShieldCheck,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { api } from "@/lib/client-api";
import type {
  Agent,
  Integration,
  IntegrationCatalogItem,
  IntegrationsPageData,
} from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

type EditorTarget = {
  catalog: IntegrationCatalogItem;
  integration?: Integration;
};

export function IntegrationsView({
  initialData,
}: {
  initialData: IntegrationsPageData;
}) {
  const [integrations, setIntegrations] = useState(initialData.integrations);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const activeProviders = new Set(
    integrations.map(({ provider }) => provider),
  );

  function updateIntegration(integration: Integration) {
    setIntegrations((current) => {
      const exists = current.some(({ id }) => id === integration.id);
      return exists
        ? current.map((item) =>
            item.id === integration.id ? integration : item,
          )
        : [...current, integration];
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="Agent capabilities"
        title="Integrations"
        description="Connect external systems as tools, then decide exactly which agents can use each capability. Credentials stay in the local control plane."
      />

      <section aria-labelledby="active-integrations">
        <SectionHeading
          id="active-integrations"
          index="01"
          title="Active integrations"
          description="Configured connections available to at least one agent."
        />
        {integrations.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {integrations.map((integration) => {
              const catalog = initialData.catalog.find(
                ({ provider }) => provider === integration.provider,
              )!;
              return (
                <ActiveCard
                  key={integration.id}
                  integration={integration}
                  onEdit={() => setEditor({ catalog, integration })}
                  onUpdated={updateIntegration}
                />
              );
            })}
          </div>
        ) : (
          <div className="grid min-h-44 place-items-center rounded-xl border border-dashed p-8 text-center">
            <div>
              <PlugZap className="mx-auto size-6 text-muted-foreground" />
              <h3 className="mt-3 font-heading text-xl font-semibold">
                No tools connected yet
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Connect PostHog below to give agents their first external
                tools.
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="mt-12" aria-labelledby="available-integrations">
        <SectionHeading
          id="available-integrations"
          index="02"
          title="Add integrations"
          description="Available tool providers for this local workspace."
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {initialData.catalog.map((item) => {
            const active =
              item.provider !== "custom" && activeProviders.has(item.provider);
            return (
              <AvailableCard
                key={item.provider}
                item={item}
                active={active}
                onConnect={() => setEditor({ catalog: item })}
              />
            );
          })}
        </div>
      </section>

      {editor?.catalog.provider === "posthog" && (
        <PostHogEditor
          key={editor.integration?.id ?? "new-posthog"}
          open
          integration={editor.integration}
          agents={initialData.agents}
          catalog={editor.catalog}
          onOpenChange={(open) => !open && setEditor(null)}
          onSaved={(integration) => {
            updateIntegration(integration);
            setEditor(null);
          }}
        />
      )}
    </>
  );
}

function SectionHeading({
  id,
  index,
  title,
  description,
}: {
  id: string;
  index: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-5 flex items-end gap-4 border-t-2 border-foreground pt-4">
      <span className="pb-1 text-xs font-bold tabular-nums text-primary">
        {index}
      </span>
      <div>
        <h2
          id={id}
          className="font-heading text-3xl font-semibold tracking-tight"
        >
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function BrandMark() {
  return (
    <div className="grid size-12 place-items-center rounded-xl border bg-background shadow-sm">
      <Image
        src="/integrations/posthog.svg"
        alt=""
        width={52}
        height={28}
        className="h-auto w-9"
      />
    </div>
  );
}

function ActiveCard({
  integration,
  onEdit,
  onUpdated,
}: {
  integration: Integration;
  onEdit: () => void;
  onUpdated: (integration: Integration) => void;
}) {
  const [testing, setTesting] = useState(false);
  const agentCount = Object.values(integration.permissions).filter(
    (tools) => tools.length > 0,
  ).length;

  async function retest() {
    setTesting(true);
    try {
      const next = await api<Integration>(
        `/api/integrations/${integration.id}/test`,
        { method: "POST" },
      );
      onUpdated(next);
      if (next.status === "connected") toast.success("PostHog is connected");
      else toast.error(next.lastError ?? "PostHog connection failed");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Connection test failed",
      );
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card className="overflow-hidden py-0">
      <CardHeader className="flex flex-row items-start justify-between p-5 pb-3">
        <div className="flex items-center gap-3">
          <BrandMark />
          <div>
            <h3 className="font-heading text-2xl font-semibold">
              {integration.name}
            </h3>
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">
              {integration.datacenter === "us" ? "US Cloud" : "EU Cloud"}
            </p>
          </div>
        </div>
        <StatusBadge status={integration.status} />
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <div className="grid grid-cols-2 gap-3 border-y py-4 text-sm">
          <div>
            <span className="block text-muted-foreground">Tools</span>
            <strong>{integration.tools.length} read-only</strong>
          </div>
          <div>
            <span className="block text-muted-foreground">Agent access</span>
            <strong>
              {agentCount} {agentCount === 1 ? "agent" : "agents"}
            </strong>
          </div>
        </div>
        <p className="mt-4 min-h-10 text-sm leading-5 text-muted-foreground">
          {integration.status === "failed"
            ? integration.lastError
            : integration.lastTestedAt
              ? `Verified ${formatDateTime(integration.lastTestedAt)}`
              : "Connection has not been tested yet."}
        </p>
      </CardContent>
      <CardFooter className="flex gap-2 border-t bg-muted/35 p-3">
        <Button variant="outline" className="flex-1" onClick={onEdit}>
          <Pencil /> Edit
        </Button>
        <Button
          variant="ghost"
          className="flex-1"
          onClick={retest}
          disabled={testing}
        >
          {testing ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          Test
        </Button>
      </CardFooter>
    </Card>
  );
}

function AvailableCard({
  item,
  active,
  onConnect,
}: {
  item: IntegrationCatalogItem;
  active: boolean;
  onConnect: () => void;
}) {
  const custom = item.provider === "custom";
  return (
    <Card
      className={cn("py-0", !item.available && "border-dashed bg-muted/20")}
    >
      <CardHeader className="flex flex-row items-start gap-3 p-5 pb-3">
        {custom ? (
          <div className="grid size-12 place-items-center rounded-xl bg-muted text-muted-foreground">
            <Puzzle className="size-6" />
          </div>
        ) : (
          <BrandMark />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-heading text-2xl font-semibold">{item.name}</h3>
            {!item.available && <Badge variant="outline">WIP</Badge>}
          </div>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {item.description}
          </p>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-4">
        <div className="flex flex-wrap gap-2">
          {item.tools.map((tool) => (
            <Badge key={tool.key} variant="outline">
              <Wrench /> {tool.name}
            </Badge>
          ))}
          {custom && (
            <span className="text-xs text-muted-foreground">
              Custom manifests and authentication are coming later.
            </span>
          )}
        </div>
      </CardContent>
      <CardFooter className="border-t p-3">
        <Button
          className="w-full"
          variant={active || !item.available ? "outline" : "default"}
          disabled={active || !item.available}
          onClick={onConnect}
        >
          {active ? <Check /> : custom ? <Clock3 /> : <PlugZap />}
          {active
            ? "Already connected"
            : custom
              ? "Coming soon"
              : `Connect ${item.name}`}
        </Button>
      </CardFooter>
    </Card>
  );
}

function PostHogEditor({
  open,
  integration,
  agents,
  catalog,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  integration?: Integration;
  agents: Agent[];
  catalog: IntegrationCatalogItem;
  onOpenChange: (open: boolean) => void;
  onSaved: (integration: Integration) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [datacenter, setDatacenter] = useState<"us" | "eu">(
    integration?.datacenter ?? "us",
  );
  const [permissions, setPermissions] = useState<Record<string, string[]>>(
    integration?.permissions ?? {},
  );
  const [saving, setSaving] = useState(false);
  const enabledAgentCount = useMemo(
    () => Object.values(permissions).filter((tools) => tools.length > 0).length,
    [permissions],
  );

  function setTool(agentId: string, toolKey: string, enabled: boolean) {
    setPermissions((current) => {
      const existing = current[agentId] ?? [];
      const tools = enabled
        ? [...new Set([...existing, toolKey])]
        : existing.filter((key) => key !== toolKey);
      return { ...current, [agentId]: tools };
    });
  }

  function setAllTools(agentId: string, enabled: boolean) {
    setPermissions((current) => ({
      ...current,
      [agentId]: enabled ? catalog.tools.map(({ key }) => key) : [],
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const next = await api<Integration>(
        integration
          ? `/api/integrations/${integration.id}`
          : "/api/integrations",
        {
          method: integration ? "PATCH" : "POST",
          body: JSON.stringify({
            ...(integration ? {} : { provider: "posthog" }),
            apiKey: apiKey || undefined,
            datacenter,
            permissions,
          }),
        },
      );
      onSaved(next);
      if (next.status === "connected") {
        toast.success("PostHog connected and agent tools updated");
      } else {
        toast.error(`Saved, but the connection failed: ${next.lastError}`);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save PostHog",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:h-auto sm:max-w-2xl">
        <DialogHeader className="border-b p-5 pr-14">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <DialogTitle className="text-2xl">
                {integration ? "Edit PostHog" : "Connect PostHog"}
              </DialogTitle>
              <DialogDescription>
                Personal API access, scoped to the agent tools you enable below.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-5 py-1">
          <section className="border-b py-5">
            <div className="mb-4 flex items-center gap-2">
              <KeyRound className="size-4" />
              <h3 className="font-semibold">Connection</h3>
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
              <label className="grid gap-2 text-sm font-semibold">
                Personal API key
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={
                    integration?.hasApiKey
                      ? "Configured · enter to replace"
                      : "phx_…"
                  }
                  autoComplete="off"
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                Datacenter
                <Select
                  value={datacenter}
                  onValueChange={(value) => setDatacenter(value as "us" | "eu")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="us">US Cloud</SelectItem>
                    <SelectItem value="eu">EU Cloud</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-xs leading-5 text-muted-foreground">
              <LockKeyhole className="mt-0.5 size-4 shrink-0" />
              <span>
                The key is encrypted locally, used only by the Next.js server,
                and verified when you save. Use the least-privilege scopes
                <strong className="font-semibold text-foreground">
                  {" "}
                  organization:read, project:read, and query:read
                </strong>
                .
              </span>
            </div>
          </section>

          <section className="py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-4" />
                  <h3 className="font-semibold">Agent tool access</h3>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Permissions are enforced when the MCP tool index is built for
                  each run.
                </p>
              </div>
              <Badge variant="outline">{enabledAgentCount} enabled</Badge>
            </div>
            <div className="mt-4 divide-y rounded-xl border">
              {agents.length ? (
                agents.map((agent) => {
                  const agentTools = permissions[agent.id] ?? [];
                  const allEnabled = catalog.tools.every(({ key }) =>
                    agentTools.includes(key),
                  );
                  return (
                    <div key={agent.id} className="p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <p className="font-semibold">{agent.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {agent.role}
                          </p>
                        </div>
                        <label className="flex items-center gap-2 text-xs font-semibold">
                          All tools
                          <Switch
                            checked={allEnabled}
                            onCheckedChange={(checked) =>
                              setAllTools(agent.id, checked)
                            }
                            aria-label={`Give ${agent.name} all PostHog tools`}
                          />
                        </label>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {catalog.tools.map((tool) => (
                          <label
                            key={tool.key}
                            className="flex cursor-pointer items-start justify-between gap-3 rounded-lg bg-muted/50 p-3"
                          >
                            <span>
                              <span className="block text-sm font-semibold">
                                {tool.name}
                              </span>
                              <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                                {tool.description}
                              </span>
                            </span>
                            <Switch
                              size="sm"
                              className="mt-1"
                              checked={agentTools.includes(tool.key)}
                              onCheckedChange={(checked) =>
                                setTool(agent.id, tool.key, checked)
                              }
                              aria-label={`${tool.name} for ${agent.name}`}
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-5 text-sm text-muted-foreground">
                  Create an agent first, then return here to assign PostHog
                  tools.
                </div>
              )}
            </div>
          </section>
        </div>

        <DialogFooter className="m-0 rounded-none px-5">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving || (!integration && !apiKey.trim())}
          >
            {saving ? <LoaderCircle className="animate-spin" /> : <PlugZap />}
            {saving ? "Saving and testing…" : "Save and test connection"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status }: { status: Integration["status"] }) {
  if (status === "connected") {
    return (
      <Badge className="bg-emerald-700 text-white">
        <Check /> Connected
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive">
        <X /> Failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <CircleAlert /> Not tested
    </Badge>
  );
}
