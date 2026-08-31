"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  Download,
  FileJson,
  FileText,
  Layers3,
  LoaderCircle,
  PackageCheck,
  PackageOpen,
  Pause,
  Play,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Trash2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { SectionHeader } from "@/components/operational-ui";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client-api";
import {
  activeBlueprintTestStatuses,
  blueprintOutcome,
  blueprintResourceHref,
  blueprintResourceTypeLabel,
  blueprintStatus,
  blueprintTestStatus,
  capabilityName,
  capabilitySettingsHref,
  firstUsefulLine,
  hasActiveBlueprintInstallation,
} from "@/lib/packs/presentation";
import type {
  OperatorPackAcceptance,
  OperatorPackCapabilityState,
  OperatorPackPreview,
  OperatorPackResource,
  OperatorPacksPageData,
  OperatorPackSummary,
} from "@/lib/types";

type BlueprintFilter = "available" | "installed";

function resourceIcon(type: OperatorPackResource["resourceType"]) {
  if (type === "agent" || type === "quick_action") return Bot;
  if (type === "automation") return Workflow;
  return FileText;
}

function BlueprintRow({
  pack,
  onOpen,
}: {
  pack: OperatorPackSummary;
  onOpen: (pack: OperatorPackSummary) => void;
}) {
  const missingRequired = pack.capabilities.filter(
    (capability) => capability.required && !capability.available,
  ).length;
  const included = [
    { label: "agents", value: pack.manifest.agents.length, icon: Bot },
    {
      label: "automations",
      value: pack.manifest.automations.length,
      icon: Workflow,
    },
    { label: "guides", value: pack.manifest.docs.length, icon: FileText },
  ].filter((item) => item.value > 0);

  return (
    <article className="group grid gap-4 border-b px-4 py-4 last:border-b-0 lg:grid-cols-[minmax(0,1.45fr)_minmax(14rem,0.85fr)_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[0.92rem] font-semibold tracking-[-0.01em]">
            {pack.manifest.name}
          </h3>
          <StatusBadge status={blueprintStatus(pack)} />
        </div>
        <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
          {blueprintOutcome(pack)}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.72rem] text-muted-foreground">
          {included.map(({ label, value, icon: Icon }) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <Icon className="size-3.5" />
              {value} {label}
            </span>
          ))}
        </div>
      </div>

      <div className="min-w-0">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
          Works with
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {pack.capabilities.slice(0, 5).map((capability) => (
            <span
              key={capability.category}
              className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[0.7rem] text-foreground/75"
            >
              {capabilityName(capability.category)}
              {capability.required && !capability.available ? (
                <AlertTriangle className="size-3 text-amber-700" />
              ) : null}
            </span>
          ))}
          {pack.capabilities.length > 5 ? (
            <span className="px-1 py-0.5 text-[0.7rem] text-muted-foreground">
              +{pack.capabilities.length - 5}
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 text-[0.7rem] text-muted-foreground">
          {missingRequired
            ? `${missingRequired} required integration${missingRequired === 1 ? " is" : "s are"} unavailable`
            : "Core requirements are ready"}
        </p>
      </div>

      <Button
        variant={hasActiveBlueprintInstallation(pack) ? "outline" : "default"}
        onClick={() => onOpen(pack)}
        className="lg:min-w-24"
      >
        {hasActiveBlueprintInstallation(pack) ? "Manage" : "Preview"}
        <ArrowRight />
      </Button>
    </article>
  );
}

function BlueprintResourceGroup({
  title,
  icon: Icon,
  items,
}: {
  title: string;
  icon: LucideIcon;
  items: { key: string; name: string; description: string; meta?: string }[];
}) {
  if (!items.length) return null;
  return (
    <div className="border-t pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2 text-xs font-semibold">
        <Icon className="size-3.5 text-muted-foreground" />
        {title}
        <span className="font-normal text-muted-foreground">
          {items.length}
        </span>
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {items.map((item) => (
          <div key={item.key} className="rounded-md bg-muted/45 px-3 py-2.5">
            <p className="text-sm font-semibold">{item.name}</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {item.description}
            </p>
            {item.meta ? (
              <p className="mt-1 text-[0.68rem] text-muted-foreground">
                {item.meta}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ResourceSnapshot({
  title,
  value,
}: {
  title: string;
  value?: Record<string, unknown>;
}) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <dl className="mt-1 space-y-1.5">
        {Object.entries(value).map(([key, item]) => (
          <div
            key={key}
            className="grid gap-0.5 sm:grid-cols-[8rem_1fr] sm:gap-3"
          >
            <dt className="font-mono text-[0.68rem] text-muted-foreground">
              {key}
            </dt>
            <dd className="min-w-0 whitespace-pre-wrap break-words text-xs leading-5">
              {typeof item === "string" ? item : JSON.stringify(item)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CapabilityList({
  title,
  capabilities,
}: {
  title: string;
  capabilities: OperatorPackCapabilityState[];
}) {
  if (!capabilities.length) return null;
  return (
    <div>
      <p className="text-xs font-semibold">{title}</p>
      <div className="mt-2 divide-y rounded-md border">
        {capabilities.map((capability) => (
          <div
            key={capability.category}
            className="grid gap-2 px-3 py-2.5 sm:grid-cols-[1fr_auto] sm:items-center"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">
                  {capabilityName(capability.category)}
                </p>
                <StatusBadge
                  status={capability.available ? "connected" : "unavailable"}
                />
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {capability.description}
              </p>
              {!capability.available ? (
                <p className="mt-1 text-[0.7rem] leading-4 text-muted-foreground">
                  {capability.required
                    ? "This is needed for the core workflow. You can install now, but the Blueprint will need setup before it can be tested or used normally."
                    : "The Blueprint still works without this integration, but this source or action will be unavailable."}
                </p>
              ) : null}
            </div>
            {!capability.available ? (
              <Button variant="ghost" size="sm" asChild>
                <Link href={capabilitySettingsHref(capability.category)}>
                  Configure <ArrowRight />
                </Link>
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ImportBlueprintDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => Promise<void>;
}) {
  const [manifest, setManifest] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      const parsed = JSON.parse(manifest) as unknown;
      await api("/api/packs", {
        method: "POST",
        body: JSON.stringify(parsed),
      });
      toast.success("Blueprint imported");
      setManifest("");
      onOpenChange(false);
      await onImported();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not import Blueprint",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Blueprint</DialogTitle>
          <DialogDescription>
            Import an advanced JSON Blueprint definition. Credentials,
            executable fields and unknown keys are rejected; never include
            secrets.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label="Blueprint JSON"
          value={manifest}
          onChange={(event) => setManifest(event.target.value)}
          rows={18}
          className="font-mono text-xs"
          placeholder={'{\n  "schemaVersion": 1,\n  "id": "my-blueprint"\n}'}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !manifest.trim()}>
            {saving ? <LoaderCircle className="animate-spin" /> : <FileJson />}
            Import Blueprint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyBlueprintList({
  filter,
  onChangeFilter,
}: {
  filter: BlueprintFilter;
  onChangeFilter: (filter: BlueprintFilter) => void;
}) {
  return (
    <div className="grid min-h-64 place-items-center px-6 py-12 text-center">
      <div className="max-w-md">
        <div className="mx-auto grid size-9 place-items-center rounded-md border bg-muted/40">
          <PackageOpen className="size-4 text-muted-foreground" />
        </div>
        <h2 className="mt-4 text-base font-semibold">
          {filter === "installed"
            ? "No Blueprints installed"
            : "No Blueprints available"}
        </h2>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
          {filter === "installed"
            ? "Install a ready-made operating capability, then manage its agents, workflows, permissions and tests here."
            : "Import a Blueprint definition to add it to this workspace."}
        </p>
        {filter === "installed" ? (
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => onChangeFilter("available")}
          >
            Browse available Blueprints
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function BlueprintsView({
  initialData,
}: {
  initialData: OperatorPacksPageData;
}) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [filter, setFilter] = useState<BlueprintFilter>("available");
  const [selected, setSelected] = useState<OperatorPackSummary | null>(null);
  const [preview, setPreview] = useState<OperatorPackPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflictStrategy, setConflictStrategy] = useState<
    "preserve" | "replace"
  >("preserve");
  const [importOpen, setImportOpen] = useState(false);
  const [justInstalled, setJustInstalled] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await api<OperatorPacksPageData>("/api/packs");
    setData(next);
    setSelected((current) =>
      current
        ? (next.packs.find(
            (pack) => pack.manifest.id === current.manifest.id,
          ) ?? null)
        : null,
    );
  }, []);

  const hasActiveTest = useMemo(
    () =>
      data.packs.some(
        (pack) =>
          pack.acceptance &&
          activeBlueprintTestStatuses.has(pack.acceptance.status),
      ),
    [data.packs],
  );

  useEffect(() => {
    if (!hasActiveTest) return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [hasActiveTest, refresh]);

  async function openBlueprint(pack: OperatorPackSummary) {
    setSelected(pack);
    setPreview(null);
    setJustInstalled(null);
    setConflictStrategy("preserve");
    setLoadingPreview(true);
    try {
      setPreview(
        await api<OperatorPackPreview>(`/api/packs/${pack.manifest.id}`),
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not preview Blueprint",
      );
    } finally {
      setLoadingPreview(false);
    }
  }

  async function install() {
    if (!selected) return;
    setSaving(true);
    try {
      await api(`/api/packs/${selected.manifest.id}/install`, {
        method: "POST",
        body: JSON.stringify({ conflictStrategy }),
      });
      toast.success(`${selected.manifest.name} installed`);
      setJustInstalled(selected.manifest.id);
      await refresh();
      setPreview(
        await api<OperatorPackPreview>(`/api/packs/${selected.manifest.id}`),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Blueprint installation failed",
      );
      await refresh().catch(() => undefined);
    } finally {
      setSaving(false);
    }
  }

  async function uninstall() {
    if (!selected) return;
    setSaving(true);
    try {
      await api(`/api/packs/${selected.manifest.id}/disable`, {
        method: "POST",
        body: "{}",
      });
      toast.success(
        `${selected.manifest.name} uninstalled without deleting your data`,
      );
      setSelected(null);
      setFilter("available");
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not uninstall Blueprint",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteDefinition() {
    if (!selected || selected.source !== "local") return;
    setSaving(true);
    try {
      await api(`/api/packs/${selected.manifest.id}`, { method: "DELETE" });
      toast.success(`${selected.manifest.name} removed`);
      setSelected(null);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not remove imported Blueprint",
      );
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    if (!selected) return;
    setSaving(true);
    try {
      const acceptance = await api<OperatorPackAcceptance>(
        `/api/packs/${selected.manifest.id}/acceptance`,
        { method: "POST", body: "{}" },
      );
      toast.success("Blueprint test queued with safe sample data");
      await refresh();
      if (acceptance.runId) router.push(`/runs/${acceptance.runId}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not run Blueprint test",
      );
    } finally {
      setSaving(false);
    }
  }

  const available = data.packs.filter(
    (pack) => !hasActiveBlueprintInstallation(pack),
  );
  const installed = data.packs.filter(hasActiveBlueprintInstallation);
  const visible = filter === "available" ? available : installed;
  const installationActive = selected
    ? hasActiveBlueprintInstallation(selected)
    : false;
  const installLabel =
    selected?.installation?.status === "partial_failure"
      ? "Finish installation"
      : selected?.updateAvailable
        ? "Install update"
        : installationActive
          ? "Reapply Blueprint"
          : "Install Blueprint";
  const showPrimaryInstall = Boolean(
    selected &&
    (!installationActive ||
      selected.updateAvailable ||
      selected.installation?.status === "partial_failure"),
  );
  const testRunning = Boolean(
    selected?.acceptance &&
    activeBlueprintTestStatuses.has(selected.acceptance.status),
  );
  const canReapply = selected?.installation?.status === "installed";

  const installButton = (
    onClick?: () => void,
    variant: "default" | "outline" = "default",
  ) => (
    <Button
      variant={variant}
      onClick={onClick}
      disabled={saving || loadingPreview || !preview}
    >
      {saving ? <LoaderCircle className="animate-spin" /> : <PackageCheck />}
      {installLabel}
    </Button>
  );

  const conflictInstallAction =
    preview?.conflicts && conflictStrategy === "replace" ? (
      <AlertDialog>
        <AlertDialogTrigger asChild>{installButton()}</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Replace {preview.conflicts} existing configuration
              {preview.conflicts === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Blueprint values will replace the configurations listed in the
              preview. Existing Work, runs, comments and unrelated resources are
              not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={install}>
              Replace and continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    ) : (
      installButton(install)
    );

  return (
    <>
      <PageHeader
        title="Blueprints"
        description="Ready-made agent teams, workflows and operating rules."
        actions={
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <FileJson /> Import Blueprint
          </Button>
        }
      />

      <Tabs
        value={filter}
        onValueChange={(value) => setFilter(value as BlueprintFilter)}
        className="mt-5"
      >
        <div className="border-b">
          <TabsList variant="line" aria-label="Blueprint collection">
            <TabsTrigger value="available">
              Available
              <span className="text-muted-foreground">{available.length}</span>
            </TabsTrigger>
            <TabsTrigger value="installed">
              Installed
              <span className="text-muted-foreground">{installed.length}</span>
            </TabsTrigger>
          </TabsList>
        </div>
      </Tabs>

      <section className="mt-4 overflow-hidden rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <SectionHeader
            title={
              filter === "available"
                ? "Available Blueprints"
                : "Installed Blueprints"
            }
            meta={
              filter === "available"
                ? "Preview what each capability adds before installing"
                : "Manage resources, requirements, permissions, tests and updates"
            }
          />
        </div>
        {visible.length ? (
          visible.map((pack) => (
            <BlueprintRow
              key={pack.manifest.id}
              pack={pack}
              onOpen={openBlueprint}
            />
          ))
        ) : (
          <EmptyBlueprintList filter={filter} onChangeFilter={setFilter} />
        )}
      </section>

      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent className="max-h-[92dvh] min-w-0 overflow-x-hidden overflow-y-auto p-0 sm:max-w-5xl">
          {selected ? (
            <>
              <DialogHeader className="sticky top-0 z-10 min-w-0 border-b bg-card/95 px-5 py-4 backdrop-blur-sm">
                <div className="flex flex-wrap items-center gap-2 pr-8">
                  <DialogTitle className="font-heading text-2xl tracking-[-0.025em]">
                    {selected.manifest.name}
                  </DialogTitle>
                  <StatusBadge status={blueprintStatus(selected)} />
                </div>
                <DialogDescription className="max-w-3xl text-sm leading-6">
                  {blueprintOutcome(selected)}
                </DialogDescription>
              </DialogHeader>

              {loadingPreview || !preview ? (
                <div className="grid min-h-80 place-items-center text-muted-foreground">
                  <LoaderCircle className="size-5 animate-spin" />
                </div>
              ) : (
                <div className="min-w-0 space-y-8 px-5 py-5">
                  {justInstalled === selected.manifest.id ? (
                    <section className="rounded-lg border border-accent bg-accent-muted/55 p-4">
                      <div className="flex gap-3">
                        <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
                          <Check className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h2 className="text-sm font-semibold">
                            Blueprint installed
                          </h2>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {selected.manifest.name} added the operating
                            resources below. Open any resource to finish
                            configuration or start working.
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {preview.installedResources
                              .filter(
                                (resource) =>
                                  resource.state === "applied" &&
                                  resource.resourceType !== "quick_action",
                              )
                              .map((resource) => {
                                const href = blueprintResourceHref(
                                  resource,
                                  preview.installedResources,
                                );
                                const change = preview.changes.find(
                                  (candidate) =>
                                    candidate.resourceType ===
                                      resource.resourceType &&
                                    candidate.resourceKey ===
                                      resource.resourceKey,
                                );
                                if (!href) return null;
                                const Icon = resourceIcon(
                                  resource.resourceType,
                                );
                                return (
                                  <Button
                                    key={resource.id}
                                    variant="outline"
                                    size="sm"
                                    asChild
                                  >
                                    <Link href={href}>
                                      <Icon />
                                      {change?.label ?? resource.resourceKey}
                                    </Link>
                                  </Button>
                                );
                              })}
                          </div>
                        </div>
                      </div>
                    </section>
                  ) : null}

                  <section>
                    <SectionHeader title="Overview" />
                    <div className="grid gap-4 border-t pt-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(14rem,0.7fr)]">
                      <div>
                        <p className="text-sm leading-6">
                          {selected.manifest.description}
                        </p>
                        <p className="mt-2 text-sm font-medium text-primary">
                          {selected.manifest.outcome}
                        </p>
                      </div>
                      <div className="rounded-md bg-muted/45 px-3 py-2.5">
                        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                          Designed for
                        </p>
                        <p className="mt-1 text-sm leading-5">
                          A working {selected.manifest.name} capability without
                          designing agents or operating rules from scratch.
                        </p>
                      </div>
                    </div>
                  </section>

                  <section>
                    <SectionHeader title="What you'll get" />
                    <div className="space-y-4 border-t pt-3">
                      <BlueprintResourceGroup
                        title="Agents"
                        icon={Bot}
                        items={selected.manifest.agents.map((agent) => ({
                          key: agent.key,
                          name: agent.name,
                          description: firstUsefulLine(agent.instructions),
                          meta: `${agent.role}${
                            agent.quickActions.length
                              ? ` · ${agent.quickActions.length} ready-made action${agent.quickActions.length === 1 ? "" : "s"}`
                              : ""
                          }`,
                        }))}
                      />
                      <BlueprintResourceGroup
                        title="Automations"
                        icon={Workflow}
                        items={selected.manifest.automations.map(
                          (automation) => ({
                            key: automation.key,
                            name: automation.name,
                            description: firstUsefulLine(automation.prompt),
                            meta: automation.cronExpression
                              ? `Scheduled workflow · installed ${
                                  automation.enabled
                                    ? "active"
                                    : "off until you activate it"
                                }`
                              : "On-demand workflow",
                          }),
                        )}
                      />
                      <BlueprintResourceGroup
                        title="Guides"
                        icon={FileText}
                        items={selected.manifest.docs.map((doc) => ({
                          key: doc.key,
                          name: doc.title,
                          description: firstUsefulLine(doc.body),
                          meta: "Added to Docs as durable operating context",
                        }))}
                      />
                      {selected.manifest.workConventions.length ? (
                        <div className="border-t pt-3">
                          <div className="flex items-center gap-2 text-xs font-semibold">
                            <Layers3 className="size-3.5 text-muted-foreground" />
                            Operating rules
                          </div>
                          <ul className="mt-2 grid gap-1.5 text-xs leading-5 text-muted-foreground md:grid-cols-2">
                            {selected.manifest.workConventions.map(
                              (convention) => (
                                <li key={convention} className="flex gap-2">
                                  <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                                  {convention}
                                </li>
                              ),
                            )}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  </section>

                  <section>
                    <SectionHeader
                      title="Requirements"
                      meta="Connect missing systems now or after installation"
                    />
                    <div className="grid gap-4 border-t pt-3 lg:grid-cols-2">
                      <CapabilityList
                        title="Required integrations"
                        capabilities={preview.capabilities.filter(
                          (capability) => capability.required,
                        )}
                      />
                      <CapabilityList
                        title="Optional integrations"
                        capabilities={preview.capabilities.filter(
                          (capability) => !capability.required,
                        )}
                      />
                    </div>
                  </section>

                  <section>
                    <SectionHeader
                      title="Permissions"
                      meta="Access remains scoped by each agent's configured integrations"
                    />
                    <div className="grid gap-4 border-t pt-3 lg:grid-cols-2">
                      <div>
                        <p className="text-xs font-semibold">
                          Normal workspace access
                        </p>
                        <div className="mt-2 divide-y rounded-md border">
                          {preview.capabilities.map((capability) => (
                            <div
                              key={capability.category}
                              className="px-3 py-2.5"
                            >
                              <p className="text-sm font-medium">
                                Use {capabilityName(capability.category)}
                              </p>
                              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                {capability.description} Access is limited to
                                the accounts and tools assigned to the installed
                                agents.
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-semibold">
                          Sensitive actions
                        </p>
                        <div className="mt-2 divide-y rounded-md border">
                          {preview.permissions.length ? (
                            preview.permissions.map((permission) => (
                              <div
                                key={`${permission.capability}:${permission.action}`}
                                className="px-3 py-2.5"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-sm font-medium">
                                    {permission.action}
                                  </p>
                                  <StatusBadge status={permission.policy} />
                                </div>
                                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                  {permission.reason}
                                </p>
                              </div>
                            ))
                          ) : (
                            <p className="p-3 text-sm text-muted-foreground">
                              No external write actions are requested by this
                              Blueprint.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </section>

                  {preview.conflicts ? (
                    <section>
                      <SectionHeader
                        title="Installation changes"
                        meta={`${preview.conflicts} existing configuration${
                          preview.conflicts === 1 ? " needs" : "s need"
                        } your decision`}
                      />
                      <div className="border-t pt-3">
                        <div className="divide-y rounded-md border border-amber-700/20 bg-amber-500/[0.035]">
                          {preview.changes
                            .filter((change) => change.action === "conflict")
                            .map((change) => (
                              <div
                                key={`${change.resourceType}:${change.resourceKey}`}
                                className="px-3 py-3"
                              >
                                <div className="flex items-start gap-2">
                                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-800" />
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold">
                                      {change.label}
                                    </p>
                                    <p className="mt-0.5 text-xs text-muted-foreground">
                                      Your current{" "}
                                      {blueprintResourceTypeLabel(
                                        change.resourceType,
                                      ).toLocaleLowerCase()}{" "}
                                      differs from this Blueprint.
                                    </p>
                                    <details className="mt-2 text-xs">
                                      <summary className="cursor-pointer font-medium text-primary">
                                        Compare configurations
                                      </summary>
                                      <div className="mt-2 grid gap-3 rounded-md bg-background p-3 lg:grid-cols-3">
                                        <ResourceSnapshot
                                          title="Originally installed"
                                          value={change.baseline}
                                        />
                                        <ResourceSnapshot
                                          title="Your current configuration"
                                          value={change.current}
                                        />
                                        <ResourceSnapshot
                                          title="Blueprint configuration"
                                          value={change.proposed}
                                        />
                                      </div>
                                    </details>
                                  </div>
                                </div>
                              </div>
                            ))}
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          <button
                            type="button"
                            aria-pressed={conflictStrategy === "preserve"}
                            onClick={() => setConflictStrategy("preserve")}
                            className={`rounded-md border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                              conflictStrategy === "preserve"
                                ? "border-primary bg-muted/55"
                                : "hover:bg-muted/35"
                            }`}
                          >
                            <span className="flex items-center gap-2 text-sm font-semibold">
                              <ShieldCheck className="size-4" />
                              Keep my existing configuration
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                              Recommended. Keep your edits and install
                              everything else from the Blueprint.
                            </span>
                          </button>
                          <button
                            type="button"
                            aria-pressed={conflictStrategy === "replace"}
                            onClick={() => setConflictStrategy("replace")}
                            className={`rounded-md border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                              conflictStrategy === "replace"
                                ? "border-primary bg-muted/55"
                                : "hover:bg-muted/35"
                            }`}
                          >
                            <span className="flex items-center gap-2 text-sm font-semibold">
                              <RefreshCw className="size-4" />
                              Replace with Blueprint configuration
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                              Replace the listed edits with the reviewed
                              Blueprint values.
                            </span>
                          </button>
                        </div>
                      </div>
                    </section>
                  ) : null}

                  <section>
                    <SectionHeader
                      title="Test this Blueprint"
                      meta="Dedicated sample records · existing customer and operational data stays unchanged"
                    />
                    <div className="grid gap-4 border-t pt-3 lg:grid-cols-[1fr_auto] lg:items-start">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold">
                            {selected.manifest.acceptanceScenarios[0]?.title}
                          </p>
                          <StatusBadge
                            status={blueprintTestStatus(selected.acceptance)}
                          />
                        </div>
                        <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
                          {
                            selected.manifest.acceptanceScenarios[0]
                              ?.description
                          }
                        </p>
                        {selected.acceptance?.error ? (
                          <p className="mt-2 text-xs text-destructive">
                            {selected.acceptance.error}
                          </p>
                        ) : null}
                        {selected.manifest.acceptanceScenarios[0] ? (
                          <details className="mt-2 text-xs">
                            <summary className="cursor-pointer font-medium text-primary">
                              See sample test
                            </summary>
                            <div className="mt-2 grid gap-3 rounded-md bg-muted/35 p-3 lg:grid-cols-2">
                              <div>
                                <p className="font-semibold">Sample context</p>
                                <p className="mt-1 leading-5 text-muted-foreground">
                                  {
                                    selected.manifest.acceptanceScenarios[0]
                                      .fixture.issueTitle
                                  }
                                </p>
                                <p className="mt-1 leading-5 text-muted-foreground">
                                  {
                                    selected.manifest.acceptanceScenarios[0]
                                      .fixture.issueDescription
                                  }
                                </p>
                              </div>
                              <div>
                                <p className="font-semibold">
                                  What Slab checks
                                </p>
                                <ul className="mt-1 space-y-1 leading-5 text-muted-foreground">
                                  <li>
                                    • The sample Work item is read successfully.
                                  </li>
                                  {selected.manifest.acceptanceScenarios[0]
                                    .rubric.requiresDocsRead ? (
                                    <li>• The sample guide is consulted.</li>
                                  ) : null}
                                  {selected.manifest.acceptanceScenarios[0]
                                    .rubric.requiresWorkWrite ? (
                                    <li>
                                      • The result is recorded in sample Work.
                                    </li>
                                  ) : null}
                                  <li>
                                    • The sample ends as{" "}
                                    {selected.manifest.acceptanceScenarios[0].rubric.expectedIssueStatus.replaceAll(
                                      "_",
                                      " ",
                                    )}
                                    .
                                  </li>
                                </ul>
                              </div>
                            </div>
                          </details>
                        ) : null}
                        {selected.acceptance?.runId ? (
                          <Link
                            href={`/runs/${selected.acceptance.runId}`}
                            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            View latest test run
                            <ArrowRight className="size-3" />
                          </Link>
                        ) : null}
                      </div>
                      <Button
                        variant="outline"
                        onClick={runTest}
                        disabled={
                          saving ||
                          testRunning ||
                          selected.installation?.status !== "installed" ||
                          selected.updateAvailable ||
                          !selected.configured
                        }
                        title={
                          !installationActive
                            ? "Install this Blueprint before testing it."
                            : !selected.configured
                              ? "Connect the required integrations before testing."
                              : selected.updateAvailable
                                ? "Install the available update before testing."
                                : undefined
                        }
                      >
                        <Play /> Run test
                      </Button>
                    </div>
                  </section>

                  {installationActive ? (
                    <section>
                      <SectionHeader
                        title="Installed Blueprint"
                        meta="Resources, health, configuration and updates"
                      />
                      <div className="border-t pt-3">
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <div className="rounded-md bg-muted/40 px-3 py-2.5">
                            <p className="text-[0.68rem] text-muted-foreground">
                              Health
                            </p>
                            <div className="mt-1">
                              <StatusBadge
                                status={
                                  selected.installation?.status ===
                                  "partial_failure"
                                    ? "partial_failure"
                                    : selected.installation?.status ===
                                        "installing"
                                      ? "installing"
                                      : selected.configured
                                        ? "ready"
                                        : "needs setup"
                                }
                              />
                            </div>
                          </div>
                          <div className="rounded-md bg-muted/40 px-3 py-2.5">
                            <p className="text-[0.68rem] text-muted-foreground">
                              Test status
                            </p>
                            <div className="mt-1">
                              <StatusBadge
                                status={blueprintTestStatus(
                                  selected.acceptance,
                                )}
                              />
                            </div>
                          </div>
                          <div className="rounded-md bg-muted/40 px-3 py-2.5">
                            <p className="text-[0.68rem] text-muted-foreground">
                              Installed version
                            </p>
                            <p className="mt-1 font-mono text-xs">
                              {selected.installation?.packVersion}
                            </p>
                          </div>
                          <div className="rounded-md bg-muted/40 px-3 py-2.5">
                            <p className="text-[0.68rem] text-muted-foreground">
                              Updates
                            </p>
                            <p className="mt-1 text-xs font-medium">
                              {selected.updateAvailable
                                ? `${selected.manifest.version} available`
                                : "Up to date"}
                            </p>
                          </div>
                        </div>

                        <div className="mt-4 divide-y rounded-md border">
                          {preview.installedResources.map((resource) => {
                            const Icon = resourceIcon(resource.resourceType);
                            const href = blueprintResourceHref(
                              resource,
                              preview.installedResources,
                            );
                            const change = preview.changes.find(
                              (candidate) =>
                                candidate.resourceType ===
                                  resource.resourceType &&
                                candidate.resourceKey === resource.resourceKey,
                            );
                            return (
                              <div
                                key={resource.id}
                                className="grid min-h-11 gap-2 px-3 py-2 sm:grid-cols-[auto_1fr_auto] sm:items-center"
                              >
                                <Icon className="size-4 text-muted-foreground" />
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">
                                    {change?.label ?? resource.resourceKey}
                                  </p>
                                  <p className="text-[0.68rem] text-muted-foreground">
                                    {blueprintResourceTypeLabel(
                                      resource.resourceType,
                                    )}{" "}
                                    ·{" "}
                                    {resource.state === "applied"
                                      ? "Ready"
                                      : resource.state}
                                  </p>
                                </div>
                                {href ? (
                                  <Button variant="ghost" size="sm" asChild>
                                    <Link href={href}>
                                      Open <ArrowRight />
                                    </Link>
                                  </Button>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" asChild>
                            <Link href="/integrations">
                              <Settings2 /> Configure integrations
                            </Link>
                          </Button>
                          <Button variant="outline" size="sm" asChild>
                            <Link href="/agents">
                              <ShieldCheck /> Review agent permissions
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </section>
                  ) : null}

                  <details className="border-t pt-3 text-xs">
                    <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                      Advanced Blueprint details
                    </summary>
                    <div className="mt-3 grid gap-3 rounded-md bg-muted/35 p-3 sm:grid-cols-3">
                      <div>
                        <p className="text-muted-foreground">Source</p>
                        <p className="mt-1 font-medium">
                          {selected.source === "official" ? "Slab" : "Imported"}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">
                          Available version
                        </p>
                        <p className="mt-1 font-mono">
                          {selected.manifest.version}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-end gap-2 sm:justify-end">
                        <Button variant="ghost" size="sm" asChild>
                          <a
                            href={`/api/packs/${selected.manifest.id}/export`}
                            download
                          >
                            <Download /> Export Blueprint
                          </a>
                        </Button>
                        {canReapply && !showPrimaryInstall
                          ? installButton(install, "outline")
                          : null}
                      </div>
                    </div>
                  </details>
                </div>
              )}

              <DialogFooter className="sticky bottom-0 z-10 mx-0 mb-0 min-w-0 flex-wrap border-t bg-card/95 px-5 py-3 backdrop-blur-sm sm:justify-between">
                <div className="flex flex-wrap gap-2">
                  {selected.source === "local" && !installationActive ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" disabled={saving}>
                          <Trash2 /> Remove imported Blueprint
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Remove this imported Blueprint?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This removes only the imported definition. Existing
                            agents, guides, Work, runs and detached resources
                            remain untouched.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={deleteDefinition}>
                            Remove Blueprint
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                  {installationActive ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" disabled={saving}>
                          <Pause /> Uninstall
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Uninstall {selected.manifest.name}?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            Blueprint automations will be paused and Blueprint
                            management will be removed. Agents, guides, Work,
                            runs and your edits remain available.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={uninstall}>
                            Uninstall Blueprint
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                </div>
                {showPrimaryInstall ? conflictInstallAction : null}
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <ImportBlueprintDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={refresh}
      />
    </>
  );
}
