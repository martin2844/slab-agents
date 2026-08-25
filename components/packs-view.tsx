"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Download,
  FileJson,
  FlaskConical,
  LoaderCircle,
  PackageCheck,
  PackageOpen,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { MetricStrip, SectionHeader } from "@/components/operational-ui";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import type {
  OperatorPackAcceptance,
  OperatorPackMetrics,
  OperatorPackPreview,
  OperatorPacksPageData,
  OperatorPackSummary,
} from "@/lib/types";

const activeAcceptance = new Set([
  "preparing",
  "queued",
  "running",
  "evaluating",
]);

function packStatus(pack: OperatorPackSummary) {
  if (!pack.installation) return "available";
  if (pack.updateAvailable) return "update available";
  if (pack.installation.status === "installed" && !pack.configured)
    return "needs setup";
  return pack.installation.status;
}

function acceptanceLabel(acceptance: OperatorPackAcceptance | null) {
  if (!acceptance) return "Not run";
  return acceptance.status.replaceAll("_", " ");
}

function acceptanceTone(status: OperatorPackAcceptance["status"] | null) {
  if (status === "passed") return "text-success";
  if (status === "failed") return "text-destructive";
  return "text-muted-foreground";
}

function PackRow({
  pack,
  onOpen,
}: {
  pack: OperatorPackSummary;
  onOpen: (pack: OperatorPackSummary) => void;
}) {
  const requiredMissing = pack.capabilities.filter(
    (capability) => capability.required && !capability.available,
  );
  const optionalAvailable = pack.capabilities.filter(
    (capability) => !capability.required && capability.available,
  );
  return (
    <article className="grid gap-4 border-b px-4 py-4 last:border-b-0 lg:grid-cols-[minmax(0,1.4fr)_minmax(12rem,0.8fr)_minmax(10rem,0.6fr)_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{pack.manifest.name}</h3>
          <StatusBadge status={packStatus(pack)} />
          {pack.source === "local" ? (
            <Badge variant="outline">Local</Badge>
          ) : null}
        </div>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          {pack.manifest.outcome}
        </p>
        <p className="mt-1 font-mono text-[0.68rem] text-muted-foreground">
          {pack.manifest.id} · v{pack.manifest.version}
        </p>
      </div>
      <div>
        <p className="text-xs font-semibold">Capabilities</p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {pack.capabilities.map((capability) => (
            <Badge
              key={capability.category}
              variant="outline"
              className={
                capability.available
                  ? "border-accent bg-accent-muted text-success"
                  : capability.required
                    ? "border-amber-600/25 bg-amber-500/10 text-amber-900"
                    : "text-muted-foreground"
              }
            >
              {capability.available ? (
                <Check />
              ) : capability.required ? (
                <X />
              ) : null}
              {capability.category.replaceAll("_", " ")}
            </Badge>
          ))}
        </div>
        <p className="mt-1.5 text-[0.7rem] text-muted-foreground">
          {requiredMissing.length
            ? `${requiredMissing.length} required missing`
            : `${optionalAvailable.length} optional available to pack Agents`}
        </p>
      </div>
      <div>
        <p className="text-xs font-semibold">Acceptance</p>
        <p
          className={`mt-1 text-sm capitalize ${acceptanceTone(pack.acceptance?.status ?? null)}`}
        >
          {acceptanceLabel(pack.acceptance)}
        </p>
        {pack.acceptance?.runId ? (
          <Link
            href={`/runs/${pack.acceptance.runId}`}
            className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            View run <ArrowUpRight className="size-3" />
          </Link>
        ) : null}
      </div>
      <Button
        variant={pack.installation ? "outline" : "default"}
        onClick={() => onOpen(pack)}
      >
        {pack.installation ? "Manage" : "Preview"}
      </Button>
    </article>
  );
}

function ChangeIcon({
  action,
}: {
  action: OperatorPackPreview["changes"][number]["action"];
}) {
  if (action === "conflict")
    return <AlertTriangle className="size-3.5 text-amber-800" />;
  if (action === "preserve")
    return <ShieldCheck className="size-3.5 text-violet-700" />;
  if (action === "detach")
    return <Pause className="size-3.5 text-muted-foreground" />;
  return <Check className="size-3.5 text-success" />;
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

function ImportPackDialog({
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
      toast.success("Local Operator Pack imported");
      setManifest("");
      onOpenChange(false);
      await onImported();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not import pack",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import local Operator Pack</DialogTitle>
          <DialogDescription>
            Paste a declarative manifest. Credential fields, executable fields,
            and unknown keys are rejected; never place secrets in text.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={manifest}
          onChange={(event) => setManifest(event.target.value)}
          rows={18}
          className="font-mono text-xs"
          placeholder={'{\n  "schemaVersion": 1,\n  "id": "my-pack"\n}'}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !manifest.trim()}>
            {saving ? <LoaderCircle className="animate-spin" /> : <FileJson />}
            Import manifest
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PacksView({
  initialData,
}: {
  initialData: OperatorPacksPageData;
}) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [selected, setSelected] = useState<OperatorPackSummary | null>(null);
  const [preview, setPreview] = useState<OperatorPackPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflictStrategy, setConflictStrategy] = useState<
    "preserve" | "replace"
  >("preserve");
  const [importOpen, setImportOpen] = useState(false);

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

  const hasActiveAcceptance = useMemo(
    () =>
      data.packs.some(
        (pack) =>
          pack.acceptance && activeAcceptance.has(pack.acceptance.status),
      ),
    [data.packs],
  );

  useEffect(() => {
    if (!hasActiveAcceptance) return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [hasActiveAcceptance, refresh]);

  async function openPack(pack: OperatorPackSummary) {
    setSelected(pack);
    setPreview(null);
    setConflictStrategy("preserve");
    setLoadingPreview(true);
    try {
      setPreview(
        await api<OperatorPackPreview>(`/api/packs/${pack.manifest.id}`),
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not preview pack",
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
      await refresh();
      setPreview(
        await api<OperatorPackPreview>(`/api/packs/${selected.manifest.id}`),
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Pack installation failed",
      );
      await refresh().catch(() => undefined);
    } finally {
      setSaving(false);
    }
  }

  async function disable() {
    if (!selected) return;
    setSaving(true);
    try {
      await api(`/api/packs/${selected.manifest.id}/disable`, {
        method: "POST",
        body: "{}",
      });
      toast.success(`${selected.manifest.name} disabled without deleting data`);
      setSelected(null);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not disable pack",
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
      toast.success(`${selected.manifest.name} definition removed`);
      setSelected(null);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete local pack",
      );
    } finally {
      setSaving(false);
    }
  }

  async function runAcceptance() {
    if (!selected) return;
    setSaving(true);
    try {
      const acceptance = await api<OperatorPackAcceptance>(
        `/api/packs/${selected.manifest.id}/acceptance`,
        { method: "POST", body: "{}" },
      );
      toast.success("Synthetic acceptance Run queued");
      await refresh();
      if (acceptance.runId) router.push(`/runs/${acceptance.runId}`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not start acceptance QA",
      );
    } finally {
      setSaving(false);
    }
  }

  const installed = data.packs.filter(
    (pack) => pack.installation?.status === "installed",
  ).length;
  const configured = data.packs.filter(
    (pack) => pack.installation?.status === "installed" && pack.configured,
  ).length;
  const metrics: OperatorPackMetrics = data.metrics;
  const installLabel =
    selected?.installation?.status === "partial_failure"
      ? "Resume install"
      : selected?.updateAvailable
        ? "Apply update"
        : selected?.installation?.status === "installed"
          ? "Reconcile"
          : "Install pack";
  const installButton = (onClick?: () => void) => (
    <Button onClick={onClick} disabled={saving || loadingPreview || !preview}>
      {saving ? <LoaderCircle className="animate-spin" /> : <PackageCheck />}
      {installLabel}
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Operator Packs"
        description={`${installed} installed · ${configured} configured · repeatable operating outcomes`}
        actions={
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <FileJson /> Import local pack
          </Button>
        }
      />

      <MetricStrip
        items={[
          {
            label: "available",
            value: data.packs.length,
            detail: "versioned manifests",
            icon: PackageOpen,
          },
          {
            label: "installed",
            value: installed,
            detail: `${configured} ready to run`,
            icon: PackageCheck,
          },
          {
            label: "acceptance runs",
            value: metrics.total,
            detail: `${metrics.running} active · ${metrics.failed} failed`,
            icon: FlaskConical,
          },
          {
            label: "pass rate",
            value:
              metrics.passRate == null
                ? "—"
                : `${Math.round(metrics.passRate * 100)}%`,
            detail: `${metrics.passed} deterministic passes`,
            ...(metrics.medianMinutesToAcceptedOutcome == null
              ? {}
              : {
                  detail: `${metrics.passed} passes · ${Math.round(metrics.medianMinutesToAcceptedOutcome)}m median to outcome`,
                }),
            icon: ShieldCheck,
          },
        ]}
      />

      <section className="mt-5 overflow-hidden rounded-lg border bg-card">
        <div className="border-b px-4 pt-4">
          <SectionHeader
            title="Available packs"
            meta="Preview every resource and permission implication before install"
          />
        </div>
        {data.packs.map((pack) => (
          <PackRow key={pack.manifest.id} pack={pack} onOpen={openPack} />
        ))}
      </section>

      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
          {selected ? (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle>{selected.manifest.name}</DialogTitle>
                  <StatusBadge status={packStatus(selected)} />
                  <Badge variant="outline">v{selected.manifest.version}</Badge>
                </div>
                <DialogDescription>
                  {selected.manifest.outcome}
                </DialogDescription>
              </DialogHeader>

              {loadingPreview || !preview ? (
                <div className="grid min-h-56 place-items-center text-sm text-muted-foreground">
                  <LoaderCircle className="size-5 animate-spin" />
                </div>
              ) : (
                <div className="space-y-5">
                  <section>
                    <SectionHeader
                      title="Resources"
                      meta={`${preview.changes.length} declared changes`}
                    />
                    <div className="divide-y rounded-lg border">
                      {preview.changes.map((change) => (
                        <details
                          key={`${change.resourceType}:${change.resourceKey}`}
                          className="group"
                        >
                          <summary className="grid min-h-11 cursor-pointer list-none grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
                            <ChangeIcon action={change.action} />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {change.label}
                              </p>
                              <p className="text-[0.68rem] text-muted-foreground">
                                {change.resourceType.replaceAll("_", " ")} ·{" "}
                                {change.resourceKey} · inspect values
                              </p>
                            </div>
                            <Badge variant="outline" className="capitalize">
                              {change.action}
                            </Badge>
                          </summary>
                          <div className="grid gap-4 border-t bg-muted/20 px-10 py-3 lg:grid-cols-3">
                            <ResourceSnapshot
                              title="Last applied baseline"
                              value={change.baseline}
                            />
                            <ResourceSnapshot
                              title="Current"
                              value={change.current}
                            />
                            <ResourceSnapshot
                              title="Proposed"
                              value={change.proposed}
                            />
                          </div>
                        </details>
                      ))}
                    </div>
                    {preview.conflicts ? (
                      <div className="mt-3 rounded-md border border-amber-600/25 bg-amber-500/[0.06] p-3">
                        <p className="text-sm font-semibold">
                          {preview.conflicts} user-owned conflicts
                        </p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          Keep existing preserves current instructions and
                          configuration. Replace applies the visible pack values
                          and establishes a new managed baseline.
                        </p>
                        <Select
                          value={conflictStrategy}
                          onValueChange={(value) =>
                            setConflictStrategy(value as "preserve" | "replace")
                          }
                        >
                          <SelectTrigger className="mt-3 w-full sm:w-64">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="preserve">
                              Keep existing (recommended)
                            </SelectItem>
                            <SelectItem value="replace">
                              Replace with pack version
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}
                  </section>

                  <div className="grid gap-5 lg:grid-cols-2">
                    <section>
                      <SectionHeader
                        title="Capabilities"
                        meta="Connected and granted to every pack Agent"
                      />
                      <div className="divide-y rounded-lg border">
                        {preview.capabilities.map((capability) => (
                          <div
                            key={capability.category}
                            className="flex min-h-12 items-center gap-3 px-3 py-2"
                          >
                            {capability.available ? (
                              <Check className="size-4 text-success" />
                            ) : (
                              <X className="size-4 text-muted-foreground" />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium capitalize">
                                {capability.category.replaceAll("_", " ")}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {capability.description}
                              </p>
                            </div>
                            <Badge variant="outline">
                              {capability.required ? "Required" : "Optional"}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </section>
                    <section>
                      <SectionHeader
                        title="Permission policy"
                        meta="Recommendations; no hidden grants"
                      />
                      <div className="divide-y rounded-lg border">
                        {preview.permissions.map((permission) => (
                          <div
                            key={`${permission.capability}:${permission.action}`}
                            className="px-3 py-2.5"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-medium">
                                {permission.action}
                              </p>
                              <StatusBadge status={permission.policy} />
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {permission.reason}
                            </p>
                          </div>
                        ))}
                        {!preview.permissions.length ? (
                          <p className="p-3 text-sm text-muted-foreground">
                            No external write permissions requested.
                          </p>
                        ) : null}
                      </div>
                    </section>
                  </div>

                  <section>
                    <SectionHeader
                      title="Synthetic acceptance"
                      meta="No customer PII or production fixtures"
                    />
                    <div className="rounded-lg border p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold">
                            {selected.manifest.acceptanceScenarios[0]?.title}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {
                              selected.manifest.acceptanceScenarios[0]
                                ?.description
                            }
                          </p>
                          {selected.acceptance ? (
                            <p
                              className={`mt-2 text-xs capitalize ${acceptanceTone(selected.acceptance.status)}`}
                            >
                              Latest: {acceptanceLabel(selected.acceptance)}
                              {` · pack v${selected.acceptance.packVersion}`}
                              {selected.acceptance.error
                                ? ` · ${selected.acceptance.error}`
                                : ""}
                            </p>
                          ) : null}
                          {selected.manifest.acceptanceScenarios[0] ? (
                            <details className="mt-2 text-xs">
                              <summary className="cursor-pointer font-medium text-primary">
                                Inspect fixture, prompt, and rubric
                              </summary>
                              <div className="mt-2 grid gap-3 rounded-md bg-muted/30 p-3 lg:grid-cols-3">
                                <ResourceSnapshot
                                  title="Synthetic fixture"
                                  value={
                                    selected.manifest.acceptanceScenarios[0]
                                      .fixture
                                  }
                                />
                                <ResourceSnapshot
                                  title="Run input"
                                  value={{
                                    prompt:
                                      selected.manifest.acceptanceScenarios[0]
                                        .prompt,
                                  }}
                                />
                                <ResourceSnapshot
                                  title="Deterministic rubric"
                                  value={
                                    selected.manifest.acceptanceScenarios[0]
                                      .rubric
                                  }
                                />
                              </div>
                            </details>
                          ) : null}
                        </div>
                        <Button
                          variant="outline"
                          onClick={runAcceptance}
                          disabled={
                            saving ||
                            selected.installation?.status !== "installed" ||
                            selected.updateAvailable ||
                            !selected.configured
                          }
                        >
                          <Play /> Run acceptance
                        </Button>
                      </div>
                    </div>
                  </section>

                  {selected.manifest.workConventions.length ? (
                    <section>
                      <SectionHeader
                        title="Work conventions"
                        meta="Visible operating rules included in this pack"
                      />
                      <ul className="list-disc space-y-1 rounded-lg border px-7 py-3 text-xs leading-5 text-muted-foreground">
                        {selected.manifest.workConventions.map((convention) => (
                          <li key={convention}>{convention}</li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </div>
              )}

              <DialogFooter className="flex-wrap sm:justify-between">
                <div className="flex gap-2">
                  <Button variant="ghost" asChild>
                    <a
                      href={`/api/packs/${selected.manifest.id}/export`}
                      download
                    >
                      <Download /> Export manifest
                    </a>
                  </Button>
                  <Button variant="ghost" asChild>
                    <Link href="/integrations">
                      <RefreshCw /> Configure capabilities
                    </Link>
                  </Button>
                </div>
                <div className="flex gap-2">
                  {selected.source === "local" &&
                  (!selected.installation ||
                    selected.installation.status === "disabled") ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" disabled={saving}>
                          <Trash2 /> Delete definition
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Delete this local definition?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This removes only the imported manifest. Existing
                            Agents, Docs, Work, Runs, and detached resources
                            remain untouched.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={deleteDefinition}>
                            Delete definition
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                  {selected.installation &&
                  selected.installation.status !== "disabled" ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" disabled={saving}>
                          <Pause /> Disable
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Disable {selected.manifest.name}?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            Pack automations will be disabled and ownership
                            detached. Agents, Docs, Work, Runs, and user changes
                            are preserved.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={disable}>
                            Disable pack
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                  {preview?.conflicts && conflictStrategy === "replace" ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        {installButton()}
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Replace {preview.conflicts} conflicting resources?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This applies the proposed values shown in the
                            three-way preview over current user edits. Existing
                            Work, Docs, Runs, and comments are not deleted.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={install}>
                            Replace and {installLabel.toLocaleLowerCase()}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : (
                    installButton(install)
                  )}
                </div>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <ImportPackDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={refresh}
      />
    </>
  );
}
