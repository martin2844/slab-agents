"use client";

import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowRight,
  Bot,
  CalendarClock,
  Check,
  CircleAlert,
  Clock3,
  Database,
  ExternalLink,
  FileText,
  GitCommitHorizontal,
  LoaderCircle,
  Mail,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSystemUpdatesStore } from "@/components/system-updates-store";
import { api, ApiClientError } from "@/lib/client-api";
import {
  describeAutomaticSystemUpdateDecision,
  deriveSystemUpdateChannelState,
  SystemUpdateRefreshCoordinator,
} from "@/lib/system-update-view-model";
import type {
  SystemUpdateAction,
  SystemUpdateChannel,
  SystemUpdateComponent,
  SystemUpdatePolicy,
  SystemUpdateRequest,
  SystemUpdatesData,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const componentIcons: Record<SystemUpdateComponent["id"], LucideIcon> = {
  agents: Bot,
  work: Activity,
  docs: FileText,
  email: Mail,
  runner: Server,
};

const hours = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, "0")}:00 UTC`,
}));

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

function shortDigest(value: string | undefined) {
  return value ? value.replace("sha256:", "").slice(0, 12) : "unknown";
}

function requestLabel(request: SystemUpdateRequest) {
  if (request.action === "check") {
    return request.source === "scheduled"
      ? "Automatic stable check"
      : `${request.channel === "candidate" ? "Candidate" : "Stable"} check`;
  }
  return request.source === "scheduled"
    ? `Automatic apply · ${request.target}`
    : `Apply ${request.target}`;
}

function ComponentRail({ component }: { component: SystemUpdateComponent }) {
  const Icon = componentIcons[component.id];
  const changed = component.status === "update_available";
  return (
    <article className="group grid gap-4 border-t border-border py-4 first:border-t-0 sm:grid-cols-[minmax(10rem,0.7fr)_minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-md border",
            changed
              ? "border-accent bg-accent text-accent-foreground"
              : "border-border bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="font-heading text-base font-[650] tracking-[-0.02em]">
            {component.name}
          </h3>
          <p className="truncate font-mono text-[0.64rem] text-muted-foreground">
            {component.services.join(" · ")}
          </p>
        </div>
      </div>

      <div className="min-w-0 pl-12 sm:pl-0">
        <p className="font-mono text-[0.62rem] font-medium uppercase tracking-[0.05em] text-muted-foreground">
          Installed
        </p>
        <p className="mt-1 truncate font-mono text-xs font-semibold">
          {component.installed?.revision ?? "Not reported"}
        </p>
        <p className="mt-0.5 truncate font-mono text-[0.62rem] text-muted-foreground">
          {shortDigest(component.installed?.digest)}
        </p>
      </div>

      <div className="hidden items-center gap-2 text-muted-foreground sm:flex">
        <span className="h-px w-5 bg-border transition-colors group-hover:bg-accent" />
        <ArrowRight className="size-3.5" />
      </div>

      <div className="flex min-w-0 items-center justify-between gap-3 pl-12 sm:pl-0">
        <div className="min-w-0">
          <p className="font-mono text-[0.62rem] font-medium uppercase tracking-[0.05em] text-muted-foreground">
            Channel target
          </p>
          <p className="mt-1 truncate font-mono text-xs font-semibold">
            {component.available?.revision ?? "Not reported"}
          </p>
          <p className="mt-0.5 truncate font-mono text-[0.62rem] text-muted-foreground">
            {shortDigest(component.available?.digest)}
          </p>
        </div>
        <StatusBadge status={component.status} />
      </div>
    </article>
  );
}

function RequestHistory({ requests }: { requests: SystemUpdateRequest[] }) {
  return (
    <section className="mt-8">
      <div className="flex items-end justify-between gap-4 border-b border-foreground/80 pb-2">
        <div>
          <p className="font-mono text-[0.64rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Host ledger
          </p>
          <h2 className="mt-1 font-heading text-xl font-[650] tracking-[-0.03em]">
            Recent requests
          </h2>
        </div>
        <span className="font-mono text-[0.64rem] text-muted-foreground">
          newest first
        </span>
      </div>
      {requests.length ? (
        <div>
          {requests.slice(0, 8).map((request) => (
            <div
              key={request.id}
              className="grid gap-2 border-b border-border py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {requestLabel(request)}
                </p>
                <p className="mt-0.5 truncate font-mono text-[0.62rem] text-muted-foreground">
                  {request.id} · {formatDate(request.requestedAt)}
                </p>
                {request.error ? (
                  <p className="mt-1 text-xs text-destructive">
                    {request.error.message}
                  </p>
                ) : null}
                {request.automaticDecision ? (
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    <span className="font-mono font-semibold uppercase">
                      {request.automaticDecision.replaceAll("_", " ")}:{" "}
                    </span>
                    {describeAutomaticSystemUpdateDecision(request, requests)}
                  </p>
                ) : null}
              </div>
              <Badge
                variant="outline"
                className="w-fit rounded-full font-mono text-[0.64rem] uppercase"
              >
                {request.source}
              </Badge>
              <StatusBadge status={request.state} />
            </div>
          ))}
        </div>
      ) : (
        <p className="border-b border-dashed border-border py-8 text-sm text-muted-foreground">
          No host requests yet. Run a check to establish the first signed
          component inventory.
        </p>
      )}
    </section>
  );
}

export function SystemUpdatesView({
  initialData,
}: {
  initialData: SystemUpdatesData;
}) {
  const {
    data: sharedData,
    refresh,
    commitData,
    seedData,
  } = useSystemUpdatesStore();
  const [sharedDataAtMount] = useState(sharedData);
  const data =
    sharedData === sharedDataAtMount
      ? initialData
      : (sharedData ?? initialData);
  const [channel, setChannel] = useState<SystemUpdateChannel>(
    initialData.latestCheck?.channel ?? "stable",
  );
  const [pendingAction, setPendingAction] = useState<SystemUpdateAction | null>(
    null,
  );
  const [policyDraft, setPolicyDraft] = useState(initialData.policy);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const policyCoordinatorRef = useRef(
    new SystemUpdateRefreshCoordinator(initialData.policy),
  );

  useEffect(() => {
    seedData(initialData);
  }, [initialData, seedData]);
  useEffect(() => {
    const response = policyCoordinatorRef.current.begin();
    const reconcilePolicy = policyCoordinatorRef.current.commit(
      response,
      data.policy,
    );
    if (reconcilePolicy) setPolicyDraft(reconcilePolicy);
  }, [data.policy]);

  const activeRequest = data.requests.find(
    ({ state }) => state === "submitted" || state === "running",
  );
  const { inventoryRequest, latestApply, needsFreshCheck, applyTarget } =
    deriveSystemUpdateChannelState(data.requests, channel);
  const inventory = inventoryRequest?.result ?? null;
  const policyDirty =
    policyDraft.enabled !== data.policy.enabled ||
    policyDraft.checkHourUtc !== data.policy.checkHourUtc;

  async function submit(action: SystemUpdateAction, target: string | null) {
    setPendingAction(action);
    try {
      const request = await api<SystemUpdateRequest>("/api/system/updates", {
        method: "POST",
        body: JSON.stringify({ action, channel, target }),
      });
      commitData((current) => {
        const base = current ?? data;
        return {
          ...base,
          latestRequest: request,
          requests: [request, ...base.requests],
        };
      });
      toast.success(
        action === "check"
          ? `${channel === "stable" ? "Stable" : "Candidate"} check queued`
          : `Update ${target} queued`,
      );
      await refresh().catch(() => undefined);
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "The host update request could not be submitted.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function savePolicy() {
    setSavingPolicy(true);
    try {
      const policy = await api<SystemUpdatePolicy>("/api/system/updates", {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: policyDraft.version,
          enabled: policyDraft.enabled,
          checkHourUtc: policyDraft.checkHourUtc,
        }),
      });
      policyCoordinatorRef.current.acceptPolicyMutation(policy);
      commitData((current) => ({ ...(current ?? data), policy }));
      setPolicyDraft(policy);
      toast.success(
        policy.enabled
          ? "Automatic stable updates enabled"
          : "Automatic updates disabled",
      );
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "The automatic update policy could not be saved.",
      );
      if (
        cause instanceof ApiClientError &&
        cause.code === "VERSION_CONFLICT"
      ) {
        policyCoordinatorRef.current.forceNextPolicySync();
        try {
          await refresh();
        } catch {
          // The next successful poll will adopt the conflicting server policy.
        }
      }
    } finally {
      setSavingPolicy(false);
    }
  }

  const checkDisabled =
    !data.bridge.available || Boolean(activeRequest) || pendingAction !== null;

  return (
    <>
      <PageHeader
        eyebrow="Stack lifecycle"
        title="System"
        description="Inspect every Slab component against one signed release, then update the stack as a single recoverable unit."
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={channel}
              onValueChange={(value) =>
                setChannel(value as SystemUpdateChannel)
              }
              disabled={Boolean(activeRequest) || pendingAction !== null}
            >
              <SelectTrigger aria-label="Release channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="stable">Stable</SelectItem>
                <SelectItem value="candidate">Candidate</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() => void submit("check", null)}
              disabled={checkDisabled}
            >
              {pendingAction === "check" ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              Check
            </Button>
          </div>
        }
      />

      <div
        className={cn(
          "mb-5 flex items-start gap-3 border px-4 py-3 text-sm",
          data.bridge.available
            ? "border-border bg-muted/45"
            : "border-amber-600/30 bg-amber-500/10 text-amber-950 dark:text-amber-100",
        )}
      >
        {data.bridge.available ? (
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
        ) : (
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
        )}
        <div>
          <p className="font-semibold">
            {data.bridge.available
              ? "Constrained host bridge"
              : "Bridge unavailable"}
          </p>
          <p className="mt-0.5 text-xs opacity-75">{data.bridge.message}</p>
        </div>
      </div>

      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="grid border-b border-border bg-petrol-deep text-white lg:grid-cols-[1.4fr_1fr]">
          <div className="p-5 sm:p-6">
            <p className="font-mono text-[0.64rem] font-semibold uppercase tracking-[0.06em] text-white/60">
              {channel} release line
            </p>
            {inventory ? (
              <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
                <div>
                  <p className="font-mono text-[0.62rem] uppercase text-white/55">
                    Installed
                  </p>
                  <p className="mt-1 font-heading text-3xl font-[675] tracking-[-0.045em]">
                    {inventory.installedStackVersion}
                  </p>
                </div>
                <ArrowRight className="mb-2.5 size-4 text-accent" />
                <div>
                  <p className="font-mono text-[0.62rem] uppercase text-white/55">
                    Signed target
                  </p>
                  <p className="mt-1 font-heading text-3xl font-[675] tracking-[-0.045em] text-accent">
                    {inventory.availableStackVersion}
                  </p>
                </div>
                <div className="mb-1 sm:ml-2">
                  <StatusBadge status={inventory.status} />
                </div>
              </div>
            ) : needsFreshCheck ? (
              <div className="mt-4 max-w-lg">
                <p className="font-heading text-2xl font-[650] tracking-[-0.03em]">
                  Fresh inventory required
                </p>
                <p className="mt-2 text-sm leading-6 text-white/65">
                  The last apply consumed its authorizing check
                  {latestApply?.error
                    ? `: ${latestApply.error.message}`
                    : "."}{" "}
                  Run a new {channel} check before another update.
                </p>
              </div>
            ) : (
              <div className="mt-4 max-w-lg">
                <p className="font-heading text-2xl font-[650] tracking-[-0.03em]">
                  No {channel} inventory yet
                </p>
                <p className="mt-2 text-sm leading-6 text-white/65">
                  Run a check to compare the installed stack with the signed
                  channel manifest.
                </p>
              </div>
            )}
          </div>

          <div className="border-t border-white/15 p-5 sm:p-6 lg:border-l lg:border-t-0">
            {inventory ? (
              <div className="flex h-full flex-col justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge className="rounded-full bg-white/10 text-white hover:bg-white/10">
                      {inventory.release.severity}
                    </Badge>
                    <span className="font-mono text-[0.64rem] text-white/55">
                      checked {formatDate(inventory.checkedAt)}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-5 text-white/70">
                    {inventory.release.rollbackCompatibleFromInstalled
                      ? "Automatic rollback is compatible from the installed release."
                      : "This release cannot automatically roll back to the installed version."}
                  </p>
                  {inventory.recoveryReason ? (
                    <p className="mt-2 text-sm text-amber-200">
                      {inventory.recoveryReason}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {inventory.release.releaseNotesUrl ? (
                    <Button
                      asChild
                      variant="ghost"
                      className="text-white hover:bg-white/10 hover:text-white"
                    >
                      <a
                        href={inventory.release.releaseNotesUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Release notes <ExternalLink />
                      </a>
                    </Button>
                  ) : null}
                  {applyTarget ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="signal" disabled={checkDisabled}>
                          Apply {applyTarget}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Update the whole Slab stack?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This applies signed {channel} release {applyTarget}{" "}
                            to Agents, Work, Docs, Email, and Runner. Active
                            agent dispatch pauses while the host updates and
                            verifies the stack.
                            {!inventory.release
                              .rollbackCompatibleFromInstalled ? (
                              <span className="mt-3 block font-semibold text-amber-800 dark:text-amber-200">
                                Automatic rollback is not compatible from the
                                installed release. Recovery may require the
                                verified host backup.
                              </span>
                            ) : null}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>
                            Keep current release
                          </AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => void submit("apply", applyTarget)}
                          >
                            Apply {applyTarget}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center text-sm leading-6 text-white/65">
                The UI submits a fixed JSON envelope. Only the root-owned host
                worker can verify and execute an update.
              </div>
            )}
          </div>
        </div>

        <div className="px-4 sm:px-6">
          {inventory ? (
            inventory.components.map((component) => (
              <ComponentRail key={component.id} component={component} />
            ))
          ) : (
            <div className="grid min-h-48 place-items-center py-10 text-center">
              <div className="max-w-sm">
                <GitCommitHorizontal className="mx-auto size-6 text-muted-foreground" />
                <p className="mt-3 text-sm font-semibold">
                  Component revisions will appear here
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Installed and available digests remain hidden until the host
                  validates a signed release manifest.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="mt-6 grid overflow-hidden rounded-lg border bg-card lg:grid-cols-[1fr_1.15fr]">
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[0.64rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                Stable only
              </p>
              <h2 className="mt-1 font-heading text-xl font-[650] tracking-[-0.03em]">
                Automatic updates
              </h2>
            </div>
            <Switch
              aria-label="Enable automatic stable updates"
              checked={policyDraft.enabled}
              disabled={savingPolicy}
              onCheckedChange={(enabled) =>
                setPolicyDraft((current) => ({ ...current, enabled }))
              }
            />
          </div>
          <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
            Check once per day and apply only an exact signed stable target with
            no recovery flag and a compatible automatic rollback path.
          </p>
          <div className="mt-5 flex flex-wrap items-end gap-3">
            <label className="grid gap-1.5 text-xs font-semibold">
              Daily check window
              <Select
                value={String(policyDraft.checkHourUtc)}
                disabled={savingPolicy}
                onValueChange={(value) =>
                  setPolicyDraft((current) => ({
                    ...current,
                    checkHourUtc: Number(value),
                  }))
                }
              >
                <SelectTrigger
                  className="w-36"
                  aria-label="Daily stable update check hour in UTC"
                >
                  <Clock3 /> <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {hours.map((hour) => (
                    <SelectItem key={hour.value} value={hour.value}>
                      {hour.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <Button
              onClick={() => void savePolicy()}
              disabled={!policyDirty || savingPolicy}
            >
              {savingPolicy ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Save />
              )}
              Save schedule
            </Button>
          </div>
          <p className="mt-3 font-mono text-[0.64rem] text-muted-foreground">
            {data.policy.lastScheduledAt
              ? `Last window claimed ${formatDate(data.policy.lastScheduledAt)}`
              : "No automatic window claimed yet"}
          </p>
        </div>

        <div className="border-t border-border bg-muted/35 p-5 sm:p-6 lg:border-l lg:border-t-0">
          <p className="font-mono text-[0.64rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Apply gate
          </p>
          <div className="mt-4 space-y-4">
            {[
              [
                ShieldCheck,
                "Signed stable manifest",
                "Candidate releases are never applied automatically.",
              ],
              [
                Database,
                "Exact component inventory",
                "The target version is copied from the completed host check.",
              ],
              [
                Check,
                "Recoverable path",
                "Recovery flags or incompatible rollback stop automatic apply.",
              ],
              [
                CalendarClock,
                "One occurrence",
                "Checks retry safely; apply requests are never replayed.",
              ],
            ].map(([Icon, title, description]) => {
              const ItemIcon = Icon as LucideIcon;
              return (
                <div key={String(title)} className="flex gap-3">
                  <ItemIcon className="mt-0.5 size-4 shrink-0 text-success" />
                  <div>
                    <p className="text-sm font-semibold">{String(title)}</p>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                      {String(description)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {activeRequest ? (
        <div
          className="mt-5 flex items-center gap-3 border border-accent bg-accent-muted px-4 py-3 text-sm"
          role="status"
        >
          <LoaderCircle className="size-4 animate-spin" />
          <div>
            <p className="font-semibold">{requestLabel(activeRequest)}</p>
            <p className="text-xs text-muted-foreground">
              Host state: {activeRequest.state.replaceAll("_", " ")}. This page
              refreshes automatically.
            </p>
          </div>
        </div>
      ) : null}

      <RequestHistory requests={data.requests} />
    </>
  );
}
