"use client";

import { useState } from "react";
import {
  CalendarDays,
  Check,
  Cloud,
  ExternalLink,
  LoaderCircle,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
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
import { GOOGLE_OAUTH_CALLBACK_PATH } from "@/lib/integrations/google-oauth-contract";
import type {
  Agent,
  CalendarProvider,
  CalendarWritePolicy,
  Integration,
} from "@/lib/types";

const providerOptions: Array<{
  provider: CalendarProvider;
  label: string;
  description: string;
}> = [
  {
    provider: "calendar_google",
    label: "Google Calendar",
    description: "OAuth, events, attendees, and free/busy.",
  },
  {
    provider: "calendar_microsoft",
    label: "Microsoft 365",
    description: "Outlook calendars through Microsoft Graph.",
  },
  {
    provider: "calendar_caldav",
    label: "CalDAV",
    description:
      "Nextcloud, Fastmail, iCloud, Radicale, and compatible servers.",
  },
  {
    provider: "calendar_calcom",
    label: "Cal.com",
    description: "Bookings and scheduling through the Cal.com API.",
  },
  {
    provider: "calendar_ics",
    label: "Shared calendar URL",
    description: "Read-only ICS feed, including Proton shared links.",
  },
];

type FormState = {
  id?: string;
  provider: CalendarProvider;
  name: string;
  baseUrl: string;
  username: string;
  password: string;
  apiKey: string;
  feedUrl: string;
  clientId: string;
  clientSecret: string;
  tenant: string;
  eventTypeId: string;
  writePolicy: CalendarWritePolicy;
  enabled: boolean;
  agentIds: string[];
};

function emptyForm(provider: CalendarProvider = "calendar_google"): FormState {
  return {
    provider,
    name:
      providerOptions.find((item) => item.provider === provider)?.label ??
      "Calendar",
    baseUrl: provider === "calendar_calcom" ? "https://api.cal.com" : "",
    username: "",
    password: "",
    apiKey: "",
    feedUrl: "",
    clientId: "",
    clientSecret: "",
    tenant: "common",
    eventTypeId: "",
    writePolicy: provider === "calendar_ics" ? "disabled" : "approval_required",
    enabled: true,
    agentIds: [],
  };
}

function formFor(integration: Integration): FormState {
  return {
    ...emptyForm(integration.provider as CalendarProvider),
    id: integration.id,
    name: integration.name,
    baseUrl: integration.baseUrl ?? "",
    username: integration.calendarUsername ?? integration.accountEmail ?? "",
    tenant: integration.calendarTenant ?? "common",
    eventTypeId: integration.calendarEventTypeId?.toString() ?? "",
    writePolicy: integration.writePolicy ?? "approval_required",
    enabled: integration.enabled,
    agentIds: Object.entries(integration.permissions)
      .filter(([, tools]) => tools.length > 0)
      .map(([agentId]) => agentId),
  };
}

export function CalendarIntegrationEditor({
  open,
  integrations,
  agents,
  callbackOrigin,
  oauthResult,
  onOpenChange,
  onUpdated,
}: {
  open: boolean;
  integrations: Integration[];
  agents: Agent[];
  callbackOrigin: string;
  oauthResult: "connected" | "failed" | null;
  onOpenChange: (open: boolean) => void;
  onUpdated: (integrations: Integration[]) => void;
}) {
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Integration | null>(null);
  const current = form?.id
    ? integrations.find(({ id }) => id === form.id)
    : null;

  function replace(next: Integration) {
    onUpdated(
      integrations.some(({ id }) => id === next.id)
        ? integrations.map((item) => (item.id === next.id ? next : item))
        : [...integrations, next],
    );
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const integration = await api<Integration>(
        form.id
          ? `/api/integrations/calendar/${form.id}`
          : "/api/integrations/calendar",
        {
          method: form.id ? "PATCH" : "POST",
          body: JSON.stringify({
            provider: form.provider,
            name: form.name,
            baseUrl: form.baseUrl || undefined,
            username: form.username || undefined,
            password: form.password || undefined,
            apiKey: form.apiKey || undefined,
            feedUrl: form.feedUrl || undefined,
            clientId: form.clientId || undefined,
            clientSecret: form.clientSecret || undefined,
            tenant: form.tenant || undefined,
            eventTypeId: form.eventTypeId
              ? Number.parseInt(form.eventTypeId, 10)
              : null,
            writePolicy: form.writePolicy,
            enabled: form.enabled,
            agentIds: form.agentIds,
            ...(current ? { expectedVersion: current.version } : {}),
          }),
        },
      );
      const refreshed = await api<Integration[]>("/api/integrations/calendar");
      onUpdated(refreshed);
      const saved =
        refreshed.find(({ id }) => id === integration.id) ?? integration;
      setForm(formFor(saved));
      toast.success(
        saved.provider === "calendar_google" ||
          saved.provider === "calendar_microsoft"
          ? saved.status === "connected"
            ? "Calendar settings saved"
            : "Calendar configuration saved. Continue with OAuth."
          : saved.status === "connected"
            ? "Calendar connected"
            : "Calendar saved with a connection error",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save calendar",
      );
    } finally {
      setSaving(false);
    }
  }

  async function connectOAuth() {
    if (!form?.id) {
      toast.error("Save OAuth configuration first");
      return;
    }
    setBusyId(form.id);
    try {
      const result = await api<{ authorizationUrl: string }>(
        `/api/integrations/calendar/${form.id}/oauth`,
        { method: "POST" },
      );
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      setBusyId(null);
      toast.error(
        error instanceof Error ? error.message : "OAuth could not start",
      );
    }
  }

  async function test(integration: Integration) {
    setBusyId(integration.id);
    try {
      const next = await api<Integration>(
        `/api/integrations/calendar/${integration.id}/test`,
        { method: "POST" },
      );
      replace(next);
      if (form?.id === next.id) setForm(formFor(next));
      if (next.status === "connected")
        toast.success("Calendar connection is healthy");
      else toast.error(next.lastError ?? "Calendar connection failed");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Calendar test failed",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function toggle(integration: Integration) {
    setBusyId(integration.id);
    try {
      replace(
        await api<Integration>(
          `/api/integrations/calendar/${integration.id}/status`,
          {
            method: "PATCH",
            body: JSON.stringify({
              enabled: !integration.enabled,
              expectedVersion: integration.version,
            }),
          },
        ),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Calendar status could not change",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function remove() {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await api<{ deleted: boolean }>(
        `/api/integrations/calendar/${deleteTarget.id}`,
        {
          method: "DELETE",
          body: JSON.stringify({ expectedVersion: deleteTarget.version }),
        },
      );
      onUpdated(integrations.filter(({ id }) => id !== deleteTarget.id));
      if (form?.id === deleteTarget.id) setForm(null);
      setDeleteTarget(null);
      toast.success("Calendar integration removed");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Calendar could not be removed",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Calendar integrations</DialogTitle>
            <DialogDescription>
              Connect calendars server-side, then scope tools and write policy
              per account.
            </DialogDescription>
          </DialogHeader>

          {!form ? (
            <div className="space-y-5">
              {oauthResult ? (
                <div
                  className={
                    oauthResult === "connected"
                      ? "rounded-lg border border-accent bg-accent-muted p-3 text-sm text-success"
                      : "rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
                  }
                  role={oauthResult === "failed" ? "alert" : "status"}
                >
                  {oauthResult === "connected"
                    ? "Calendar authorization completed successfully."
                    : "Calendar authorization failed or was cancelled. Verify the callback URI, OAuth client, tenant, and consent settings, then try again."}
                </div>
              ) : null}
              {integrations.length ? (
                <div className="divide-y rounded-lg border">
                  {integrations.map((integration) => (
                    <div
                      key={integration.id}
                      className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="grid size-8 place-items-center rounded-md border bg-muted/30">
                          <CalendarDays className="size-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold">
                              {integration.name}
                            </p>
                            <HealthBadge integration={integration} />
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {
                              providerOptions.find(
                                ({ provider }) =>
                                  provider === integration.provider,
                              )?.label
                            }
                            {integration.accountEmail
                              ? ` · ${integration.accountEmail}`
                              : ""}
                            {` · ${integration.tools.length} tools · ${Object.keys(integration.permissions).length} agents`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={integration.enabled}
                          disabled={busyId === integration.id}
                          onCheckedChange={() => toggle(integration)}
                          aria-label={`${integration.name} enabled`}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => test(integration)}
                          disabled={busyId === integration.id}
                        >
                          {busyId === integration.id ? (
                            <LoaderCircle className="animate-spin" />
                          ) : (
                            <RefreshCw />
                          )}
                          Test
                        </Button>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          onClick={() => setForm(formFor(integration))}
                          aria-label={`Edit ${integration.name}`}
                        >
                          <Pencil />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid min-h-28 place-items-center rounded-lg border border-dashed text-center">
                  <div>
                    <CalendarDays className="mx-auto size-5 text-muted-foreground" />
                    <p className="mt-2 text-sm font-semibold">
                      No calendars connected
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Add a provider to expose calendar tools to agents.
                    </p>
                  </div>
                </div>
              )}
              <div>
                <p className="mb-2 font-mono text-xs font-medium uppercase tracking-[0.02em] text-muted-foreground">
                  Add provider
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {providerOptions.map((option) => (
                    <button
                      key={option.provider}
                      type="button"
                      className="rounded-lg border p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setForm(emptyForm(option.provider))}
                    >
                      <span className="text-sm font-semibold">
                        {option.label}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        {option.description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <CalendarForm
              form={form}
              setForm={setForm}
              agents={agents}
              current={current ?? undefined}
              saving={saving}
              oauthBusy={busyId === form.id}
              callbackOrigin={callbackOrigin}
              onSave={save}
              onConnectOAuth={connectOAuth}
              onDelete={() => current && setDeleteTarget(current)}
              onBack={() => setForm(null)}
            />
          )}

          {!form ? (
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(next) => !next && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete calendar integration?</AlertDialogTitle>
            <AlertDialogDescription>
              Agent assignments will be removed. Historical runs keep their
              audit metadata.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>
              Delete integration
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CalendarForm({
  form,
  setForm,
  agents,
  current,
  saving,
  oauthBusy,
  callbackOrigin,
  onSave,
  onConnectOAuth,
  onDelete,
  onBack,
}: {
  form: FormState;
  setForm: (form: FormState) => void;
  agents: Agent[];
  current?: Integration;
  saving: boolean;
  oauthBusy: boolean;
  callbackOrigin: string;
  onSave: () => void;
  onConnectOAuth: () => void;
  onDelete: () => void;
  onBack: () => void;
}) {
  const oauth =
    form.provider === "calendar_google" ||
    form.provider === "calendar_microsoft";
  const callbackPath =
    form.provider === "calendar_google"
      ? GOOGLE_OAUTH_CALLBACK_PATH
      : "/api/integrations/calendar/microsoft/callback";
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border-b pb-3">
        <div>
          <p className="text-sm font-semibold">
            {current
              ? `Edit ${current.name}`
              : `Connect ${providerOptions.find(({ provider }) => provider === form.provider)?.label}`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Secrets are encrypted locally and are never returned to this dialog.
          </p>
        </div>
        {current ? <HealthBadge integration={current} /> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Name"
          value={form.name}
          onChange={(name) => setForm({ ...form, name })}
        />
        {form.provider !== "calendar_ics" ? (
          <label className="grid gap-1.5 text-xs font-semibold">
            Write policy
            <Select
              value={form.writePolicy}
              onValueChange={(value) =>
                setForm({
                  ...form,
                  writePolicy: value as CalendarWritePolicy,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="disabled">Disabled</SelectItem>
                <SelectItem value="approval_required">
                  Approval required
                </SelectItem>
                <SelectItem value="autonomous">Autonomous</SelectItem>
              </SelectContent>
            </Select>
          </label>
        ) : null}
      </div>

      {oauth ? (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <Cloud className="size-4" />
            <p className="text-sm font-semibold">OAuth application</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Client ID"
              value={form.clientId}
              placeholder={
                current?.oauthConfigured
                  ? "Configured · enter to replace"
                  : "OAuth client ID"
              }
              onChange={(clientId) => setForm({ ...form, clientId })}
            />
            <Field
              label="Client secret"
              type="password"
              value={form.clientSecret}
              placeholder={
                current?.hasSecret
                  ? "Configured · enter to replace"
                  : "OAuth client secret"
              }
              onChange={(clientSecret) => setForm({ ...form, clientSecret })}
            />
            {form.provider === "calendar_microsoft" ? (
              <Field
                label="Tenant"
                value={form.tenant}
                onChange={(tenant) => setForm({ ...form, tenant })}
              />
            ) : null}
          </div>
          <div className="rounded-md bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
            <strong className="text-foreground">Authorized redirect URI</strong>
            <code className="mt-1 block break-all font-mono">
              {callbackOrigin || "https://your-workspace.example"}
              {callbackPath}
            </code>
            {form.provider === "calendar_google"
              ? "Enable Google Calendar API and add this URI to a Web application OAuth client."
              : "Add this URI to the Microsoft Entra app and enable delegated User.Read, offline_access, and Calendars.ReadWrite permissions."}
          </div>
        </div>
      ) : null}

      {form.provider === "calendar_caldav" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="CalDAV URL"
            type="url"
            value={form.baseUrl}
            placeholder="https://calendar.example.com/dav/"
            onChange={(baseUrl) => setForm({ ...form, baseUrl })}
          />
          <Field
            label="Username"
            value={form.username}
            onChange={(username) => setForm({ ...form, username })}
          />
          <Field
            label="Password / app password"
            type="password"
            value={form.password}
            placeholder={
              current?.hasSecret
                ? "Configured · enter to replace"
                : "App password"
            }
            onChange={(password) => setForm({ ...form, password })}
          />
        </div>
      ) : null}

      {form.provider === "calendar_calcom" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Cal.com API URL"
            type="url"
            value={form.baseUrl}
            onChange={(baseUrl) => setForm({ ...form, baseUrl })}
          />
          <Field
            label="API key"
            type="password"
            value={form.apiKey}
            placeholder={
              current?.hasSecret ? "Configured · enter to replace" : "cal_…"
            }
            onChange={(apiKey) => setForm({ ...form, apiKey })}
          />
          <Field
            label="Default event type ID"
            type="number"
            value={form.eventTypeId}
            placeholder="Required for creating bookings"
            onChange={(eventTypeId) => setForm({ ...form, eventTypeId })}
          />
        </div>
      ) : null}

      {form.provider === "calendar_ics" ? (
        <div className="space-y-3">
          <Field
            label="Private/shared ICS URL"
            type="url"
            value={form.feedUrl}
            placeholder={
              current?.hasSecret
                ? "Configured · enter to replace"
                : "https://…/calendar.ics"
            }
            onChange={(feedUrl) => setForm({ ...form, feedUrl })}
          />
          <p className="rounded-md border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
            Shared feeds are read-only. Proton Calendar currently supports this
            form of external subscription but not CalDAV or a public write API.
            Treat the URL as a secret.
          </p>
        </div>
      ) : null}

      <section className="rounded-lg border p-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4" />
          <div>
            <p className="text-sm font-semibold">Agent access</p>
            <p className="text-xs text-muted-foreground">
              Changes apply to each agent&apos;s next run.
            </p>
          </div>
        </div>
        <div className="mt-3 divide-y border-y">
          {agents.map((agent) => {
            const checked = form.agentIds.includes(agent.id);
            return (
              <label
                key={agent.id}
                className="flex min-h-11 items-center justify-between gap-3 text-sm"
              >
                <span>
                  <strong>{agent.name}</strong>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {agent.role}
                  </span>
                </span>
                <Switch
                  checked={checked}
                  onCheckedChange={(next) =>
                    setForm({
                      ...form,
                      agentIds: next
                        ? [...form.agentIds, agent.id]
                        : form.agentIds.filter((id) => id !== agent.id),
                    })
                  }
                  aria-label={`${form.name} access for ${agent.name}`}
                />
              </label>
            );
          })}
          {!agents.length ? (
            <p className="py-3 text-xs text-muted-foreground">
              Create an agent before assigning calendar access.
            </p>
          ) : null}
        </div>
      </section>

      <div className="flex flex-col-reverse justify-between gap-2 border-t pt-4 sm:flex-row">
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          {current ? (
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={onDelete}
            >
              <Trash2 /> Delete
            </Button>
          ) : null}
        </div>
        <div className="flex gap-2">
          {oauth && current ? (
            <Button
              variant="outline"
              onClick={onConnectOAuth}
              disabled={oauthBusy}
            >
              {oauthBusy ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <ExternalLink />
              )}
              {current.status === "connected"
                ? "Reconnect account"
                : "Authorize account"}
            </Button>
          ) : null}
          <Button onClick={onSave} disabled={saving}>
            {saving ? <LoaderCircle className="animate-spin" /> : <Check />}
            {saving
              ? "Saving…"
              : oauth && !current
                ? "Save OAuth configuration"
                : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold">
      {label}
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function HealthBadge({ integration }: { integration: Integration }) {
  if (!integration.enabled) return <Badge variant="secondary">Disabled</Badge>;
  if (integration.status === "connected")
    return (
      <Badge className="gap-1 border-accent bg-accent-muted text-success">
        <Check className="size-3" /> Connected
      </Badge>
    );
  if (integration.status === "failed")
    return (
      <Badge variant="destructive" className="gap-1">
        <X className="size-3" /> Error
      </Badge>
    );
  return <Badge variant="secondary">Not tested</Badge>;
}
