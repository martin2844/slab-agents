"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  BrainCircuit,
  CalendarDays,
  EyeOff,
  LoaderCircle,
  KeyRound,
  Mail,
  PlugZap,
  Save,
  Server,
  ShieldCheck,
  TerminalSquare,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { EmailIntegrationEditor } from "@/components/email-integration-editor";
import { CalendarIntegrationEditor } from "@/components/calendar-integration-editor";
import { RuntimeSettings } from "@/components/runtime-settings";
import { BudgetSettings } from "@/components/budget-settings";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/client-api";
import type {
  Agent,
  EmailIntegrationState,
  Integration,
  SetupStatus,
  WorkspaceSettings,
  RuntimeCatalogItem,
  BudgetConfiguration,
} from "@/lib/types";

type Service = "work" | "docs" | "runner" | "codex";
type State = "idle" | "testing" | "connected" | "error";

export function SettingsView({
  initialSettings,
  initialSetup,
  initialEmail,
  initialCalendars,
  auth,
  agents,
  initialTab,
  initialEmailOpen,
  initialCalendarOpen,
  initialCalendarResult,
  initialRuntimes,
  initialBudget,
  calendarCallbackOrigin: configuredCalendarCallbackOrigin,
}: {
  initialSettings: WorkspaceSettings;
  initialSetup: SetupStatus;
  initialEmail: EmailIntegrationState;
  initialCalendars: Integration[];
  auth: { required: boolean; configured: boolean };
  agents: Agent[];
  initialTab: "sources" | "runtime" | "email" | "calendar" | "memory";
  initialEmailOpen: boolean;
  initialCalendarOpen: boolean;
  initialCalendarResult: "connected" | "failed" | null;
  calendarCallbackOrigin: string;
  initialRuntimes: RuntimeCatalogItem[];
  initialBudget: BudgetConfiguration;
}) {
  const router = useRouter();
  const initialServiceState = (service: Service): State => {
    const value = initialSetup.checks.find(
      (item) => item.service === service,
    )?.state;
    if (value === "connected") return "connected";
    if (value === "failed") return "error";
    return "idle";
  };
  const [settings, setSettings] = useState<WorkspaceSettings | null>(
    initialSettings,
  );
  const [error] = useState("");
  const [workKey, setWorkKey] = useState("");
  const [docsKey, setDocsKey] = useState("");
  const [honchoKey, setHonchoKey] = useState("");
  const [memoryState, setMemoryState] = useState<State>("idle");
  const [email, setEmail] = useState(initialEmail);
  const [emailOpen, setEmailOpen] = useState(initialEmailOpen);
  const [calendars, setCalendars] = useState(initialCalendars);
  const [calendarOpen, setCalendarOpen] = useState(initialCalendarOpen);
  const [calendarResult, setCalendarResult] = useState(initialCalendarResult);
  const [calendarCallbackOrigin, setCalendarCallbackOrigin] = useState(
    configuredCalendarCallbackOrigin,
  );
  const [gmailCallbackUrl, setGmailCallbackUrl] = useState(
    "/api/integrations/email/google/callback",
  );
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [status, setStatus] = useState<Record<Service, State>>({
    work: initialServiceState("work"),
    docs: initialServiceState("docs"),
    runner: initialServiceState("runner"),
    codex: initialServiceState("codex"),
  });

  async function persistSettings() {
    if (!settings) throw new Error("Settings are not loaded");
    const updated = await api<WorkspaceSettings>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        workMcpUrl: settings.workMcpUrl,
        workApiKey: workKey || undefined,
        docsMcpUrl: settings.docsMcpUrl,
        docsApiKey: docsKey || undefined,
        runnerUrl: settings.runnerUrl,
        operatorDisplayName: settings.operatorDisplayName,
        coordinationReviewer: settings.coordinationReviewer,
        memoryProvider: settings.memoryProvider,
        honchoUrl: settings.honchoUrl,
        honchoApiKey: honchoKey || undefined,
        honchoWorkspaceId: settings.honchoWorkspaceId,
        memoryMaxContextTokens: settings.memoryMaxContextTokens,
      }),
    });
    setSettings(updated);
    setWorkKey("");
    setDocsKey("");
    setHonchoKey("");
    return updated;
  }

  async function testMemory() {
    if (!settings) return;
    if (settings.memoryProvider === "disabled") {
      setMemoryState("idle");
      toast.message("Persistent memory is disabled");
      return;
    }
    setMemoryState("testing");
    try {
      await persistSettings();
      const result = await api<{
        status: "connected" | "disabled" | "unavailable";
        detail: string;
      }>("/api/settings/memory/test", { method: "POST" });
      if (result.status !== "connected") throw new Error(result.detail);
      setMemoryState("connected");
      toast.success(result.detail);
    } catch (cause) {
      setMemoryState("error");
      toast.error(
        cause instanceof Error ? cause.message : "Honcho is unavailable",
      );
    }
  }

  async function save() {
    try {
      await persistSettings();
      toast.success("Settings saved");
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not save settings",
      );
    }
  }

  async function test(service: Service) {
    setStatus((current) => ({ ...current, [service]: "testing" }));
    try {
      await persistSettings();
      const result = await api<SetupStatus>("/api/settings/test", {
        method: "POST",
        body: JSON.stringify({ service }),
      });
      const check = result.checks.find((item) => item.service === service);
      const next = check?.state === "connected" ? "connected" : "error";
      setStatus((current) => ({ ...current, [service]: next }));
      if (next === "error")
        throw new Error(check?.detail ?? `${service} is unavailable`);
      if (service === "runner") {
        setStatus((current) => ({ ...current, codex: "testing" }));
        const runtime = await api<SetupStatus>("/api/settings/test", {
          method: "POST",
          body: JSON.stringify({ service: "codex" }),
        });
        const codex = runtime.checks.find((item) => item.service === "codex");
        setStatus((current) => ({
          ...current,
          codex: codex?.state === "connected" ? "connected" : "error",
        }));
      }
    } catch (cause) {
      setStatus((current) => ({ ...current, [service]: "error" }));
      toast.error(
        cause instanceof Error ? cause.message : `${service} is unavailable`,
      );
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("New password confirmation does not match");
      return;
    }
    setPasswordSaving(true);
    try {
      await api<{ changed: boolean }>("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      toast.success("Password changed. Sign in again.");
      router.push("/login");
      router.refresh();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not change password",
      );
      setPasswordSaving(false);
    }
  }

  if (error) return <ErrorState message={error} />;
  if (!settings) return <LoadingState />;

  return (
    <>
      <PageHeader
        title="Settings"
        description={`${initialSetup.connected}/${initialSetup.total} systems healthy · configuration stored locally`}
        actions={
          <Button onClick={save}>
            <Save /> Save changes
          </Button>
        }
      />
      <Tabs defaultValue={initialTab} className="space-y-5">
        <TabsList className="h-9 w-full justify-start overflow-x-auto rounded-lg border bg-card p-1 sm:w-auto">
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="runtime">Runtime</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="memory">Memory</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>

        <TabsContent value="sources" className="space-y-4">
          <section className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 sm:p-5">
            <label className="grid gap-1.5 text-xs font-semibold">
              Operator display name
              <Input
                value={settings.operatorDisplayName}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    operatorDisplayName: event.target.value,
                  })
                }
              />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold">
              Coordination reviewer
              <Input
                value={settings.coordinationReviewer}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    coordinationReviewer: event.target.value,
                  })
                }
                placeholder="Agent slug, name, or ID"
              />
            </label>
          </section>
          <ConnectionPanel
            title="Work · Slab"
            description="Operational work via remote MCP"
            icon={Server}
            state={status.work}
            url={settings.workMcpUrl}
            setUrl={(value) => setSettings({ ...settings, workMcpUrl: value })}
            secret={workKey}
            setSecret={setWorkKey}
            configured={settings.workApiKeyConfigured}
            onTest={() => test("work")}
          />
          <ConnectionPanel
            title="Docs · Slab Docs"
            description="Company knowledge via remote MCP"
            icon={PlugZap}
            state={status.docs}
            url={settings.docsMcpUrl}
            setUrl={(value) => setSettings({ ...settings, docsMcpUrl: value })}
            secret={docsKey}
            setSecret={setDocsKey}
            configured={settings.docsApiKeyConfigured}
            onTest={() => test("docs")}
          />
        </TabsContent>

        <TabsContent value="runtime">
          <section className="rounded-lg border bg-card p-4 sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex gap-3">
                <TerminalSquare className="mt-0.5 size-4" />
                <div>
                  <h2 className="text-sm font-semibold">Runner</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Loopback-only execution service
                  </p>
                </div>
              </div>
              <ConnectionBadge state={status.runner} />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <label className="grid gap-1.5 text-xs font-semibold">
                Runner URL
                <Input
                  value={settings.runnerUrl}
                  onChange={(event) =>
                    setSettings({ ...settings, runnerUrl: event.target.value })
                  }
                  type="url"
                />
              </label>
              <Button
                variant="outline"
                onClick={() => test("runner")}
                disabled={status.runner === "testing"}
              >
                {status.runner === "testing" ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <PlugZap />
                )}{" "}
                Test connection
              </Button>
            </div>
            <RuntimeSettings initialRuntimes={initialRuntimes} />
            <BudgetSettings
              initialBudget={initialBudget}
              agents={agents}
              runtimes={initialRuntimes}
            />
          </section>
        </TabsContent>

        <TabsContent value="email">
          <section className="rounded-lg border bg-card p-4 sm:p-5">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div className="flex gap-3">
                <Mail className="mt-0.5 size-4" />
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold">Email service</h2>
                    <Badge variant="secondary">Optional</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Workspace mailboxes and agent-scoped read, draft, and send
                    policies
                  </p>
                </div>
              </div>
              <EmailConnectionBadge state={email} />
            </div>
            <div className="mt-4 grid gap-4 border-y py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center">
              <div className="min-w-0">
                <span className="block text-xs text-muted-foreground">
                  Service
                </span>
                <strong className="block truncate">
                  {email.serviceUrl || "Not configured"}
                </strong>
              </div>
              <div>
                <span className="block text-xs text-muted-foreground">
                  Mailboxes
                </span>
                <strong>{email.accounts.length}</strong>
              </div>
              <div>
                <span className="block text-xs text-muted-foreground">
                  Agent profiles
                </span>
                <strong>{email.assignments.length}</strong>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setGmailCallbackUrl(
                    `${window.location.origin}/api/integrations/email/google/callback`,
                  );
                  setEmailOpen(true);
                }}
              >
                <Mail /> Configure email
              </Button>
            </div>
            {email.accounts.length > 0 && email.assignments.length === 0 ? (
              <div className="mt-4 flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm sm:flex-row sm:items-center sm:justify-between dark:border-amber-900 dark:bg-amber-950/30">
                <div>
                  <p className="font-semibold">No agent can use Email yet</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Assign a mailbox and permissions to an agent. The capability
                    becomes available on that agent&apos;s next run.
                  </p>
                </div>
                <Button variant="outline" onClick={() => setEmailOpen(true)}>
                  Assign agent access
                </Button>
              </div>
            ) : null}
          </section>
        </TabsContent>

        <TabsContent value="calendar">
          <section className="rounded-lg border bg-card p-4 sm:p-5">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div className="flex gap-3">
                <CalendarDays className="mt-0.5 size-4" />
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold">Calendar</h2>
                    <Badge variant="secondary">Optional</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Google, Microsoft, CalDAV, Cal.com, and read-only shared
                    calendars
                  </p>
                </div>
              </div>
              <Badge
                variant={
                  calendars.some(
                    (integration) =>
                      integration.enabled && integration.status === "failed",
                  )
                    ? "destructive"
                    : "secondary"
                }
              >
                {
                  calendars.filter(
                    (integration) =>
                      integration.enabled && integration.status === "connected",
                  ).length
                }{" "}
                healthy
              </Badge>
            </div>
            <div className="mt-4 grid gap-4 border-y py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center">
              <div className="min-w-0">
                <span className="block text-xs text-muted-foreground">
                  Providers
                </span>
                <strong className="block truncate capitalize">
                  {calendars.length
                    ? [
                        ...new Set(
                          calendars.map(({ provider }) =>
                            provider.replace("calendar_", ""),
                          ),
                        ),
                      ].join(", ")
                    : "Not configured"}
                </strong>
              </div>
              <div>
                <span className="block text-xs text-muted-foreground">
                  Accounts
                </span>
                <strong>{calendars.length}</strong>
              </div>
              <div>
                <span className="block text-xs text-muted-foreground">
                  Agent access
                </span>
                <strong>
                  {
                    new Set(
                      calendars.flatMap((integration) =>
                        Object.keys(integration.permissions),
                      ),
                    ).size
                  }
                </strong>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  if (!configuredCalendarCallbackOrigin)
                    setCalendarCallbackOrigin(window.location.origin);
                  setCalendarOpen(true);
                }}
              >
                <CalendarDays /> Configure calendar
              </Button>
            </div>
            {calendars.length > 0 &&
            calendars.every(
              (integration) =>
                Object.keys(integration.permissions).length === 0,
            ) ? (
              <div className="mt-4 flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm sm:flex-row sm:items-center sm:justify-between dark:border-amber-900 dark:bg-amber-950/30">
                <div>
                  <p className="font-semibold">No agent can use Calendar yet</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Assign at least one connected account. New permissions apply
                    on the next run.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (!configuredCalendarCallbackOrigin)
                      setCalendarCallbackOrigin(window.location.origin);
                    setCalendarOpen(true);
                  }}
                >
                  Assign agent access
                </Button>
              </div>
            ) : null}
          </section>
        </TabsContent>

        <TabsContent value="memory">
          <section className="max-w-4xl rounded-lg border bg-card p-4 sm:p-5">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div className="flex gap-3">
                <BrainCircuit className="mt-0.5 size-4" />
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold">
                      Persistent agent memory
                    </h2>
                    <Badge variant="secondary">Optional</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Honcho remembers operator preferences and corrections across
                    conversations. Work, Docs, Email, and integrations remain the
                    sources of truth. Disabling recall does not delete data already
                    stored by the provider.
                  </p>
                </div>
              </div>
              {settings.memoryProvider === "disabled" ? (
                <Badge variant="outline">Disabled</Badge>
              ) : (
                <ConnectionBadge state={memoryState} />
              )}
            </div>

            <div className="mt-4 grid gap-3 border-y py-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-semibold">
                Provider
                <Select
                  value={settings.memoryProvider}
                  onValueChange={(value) => {
                    if (value !== "disabled" && value !== "honcho") return;
                    setSettings({ ...settings, memoryProvider: value });
                    setMemoryState("idle");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="disabled">Disabled</SelectItem>
                    <SelectItem value="honcho">Honcho</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-1.5 text-xs font-semibold">
                Workspace ID
                <Input
                  value={settings.honchoWorkspaceId}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      honchoWorkspaceId: event.target.value,
                    })
                  }
                  disabled={settings.memoryProvider === "disabled"}
                />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold sm:col-span-2">
                Honcho URL
                <Input
                  value={settings.honchoUrl}
                  onChange={(event) =>
                    setSettings({ ...settings, honchoUrl: event.target.value })
                  }
                  type="url"
                  disabled={settings.memoryProvider === "disabled"}
                />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold">
                API key
                <div className="relative">
                  <Input
                    value={honchoKey}
                    onChange={(event) => setHonchoKey(event.target.value)}
                    type="password"
                    placeholder={
                      settings.honchoApiKeyConfigured
                        ? "Configured · enter to replace"
                        : "Optional for unauthenticated self-hosting"
                    }
                    disabled={settings.memoryProvider === "disabled"}
                  />
                  <EyeOff className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                </div>
              </label>
              <label className="grid gap-1.5 text-xs font-semibold">
                Maximum recalled context
                <div className="flex items-center gap-2">
                  <Input
                    value={settings.memoryMaxContextTokens}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        memoryMaxContextTokens: Number(event.target.value),
                      })
                    }
                    type="number"
                    min={200}
                    max={4000}
                    disabled={settings.memoryProvider === "disabled"}
                  />
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    tokens
                  </span>
                </div>
              </label>
            </div>

            <div className="mt-4 flex flex-col justify-between gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center">
              <p>
                Only operator-authored chat messages are recorded. Raw tool
                outputs and generated Work events are excluded.
              </p>
              <Button
                variant="outline"
                onClick={testMemory}
                disabled={
                  settings.memoryProvider === "disabled" ||
                  memoryState === "testing"
                }
              >
                {memoryState === "testing" ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <PlugZap />
                )}
                Test connection
              </Button>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="security">
          <section className="max-w-3xl rounded-lg border bg-card p-4 sm:p-5">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 size-4 text-success" />
              <div>
                <h2 className="text-sm font-semibold">
                  Server-side security boundary
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  The browser never receives MCP credentials. React talks only
                  to Next route handlers; MCP clients and Runner requests
                  execute in the Node.js runtime.
                </p>
              </div>
            </div>
            <dl className="mt-4 divide-y border-y text-sm">
              {[
                ["Workspace", "Single user · local"],
                ["Work source", "Slab"],
                ["Docs source", "Slab Docs"],
                ["Agent runtime", "Configured per agent"],
                ["Runner boundary", "127.0.0.1"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex min-h-11 items-center justify-between gap-4"
                >
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            {auth.required && auth.configured ? (
              <form
                onSubmit={changePassword}
                className="mt-5 grid gap-3 border-t pt-4 sm:grid-cols-3"
              >
                <label className="grid gap-1.5 text-xs font-semibold">
                  Current password
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    required
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-semibold">
                  New password
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    minLength={12}
                    required
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-semibold">
                  Confirm password
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    minLength={12}
                    required
                  />
                </label>
                <div className="sm:col-span-3">
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={passwordSaving}
                  >
                    {passwordSaving ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <KeyRound />
                    )}
                    {passwordSaving ? "Changing…" : "Change password"}
                  </Button>
                </div>
              </form>
            ) : null}
          </section>
        </TabsContent>
      </Tabs>
      <EmailIntegrationEditor
        open={emailOpen}
        initialState={email}
        agents={agents}
        gmailCallbackUrl={gmailCallbackUrl}
        microsoftCallbackUrl={gmailCallbackUrl.replace(
          "/google/callback",
          "/microsoft/callback",
        )}
        onOpenChange={setEmailOpen}
        onUpdated={setEmail}
      />
      <CalendarIntegrationEditor
        open={calendarOpen}
        integrations={calendars}
        agents={agents}
        callbackOrigin={calendarCallbackOrigin}
        oauthResult={calendarResult}
        onOpenChange={(next) => {
          setCalendarOpen(next);
          if (!next && calendarResult) {
            setCalendarResult(null);
            router.replace("/settings?tab=calendar", { scroll: false });
          }
        }}
        onUpdated={setCalendars}
      />
    </>
  );
}

function ConnectionPanel({
  title,
  description,
  icon: Icon,
  state,
  url,
  setUrl,
  secret,
  setSecret,
  configured,
  onTest,
}: {
  title: string;
  description: string;
  icon: typeof Server;
  state: State;
  url: string;
  setUrl: (value: string) => void;
  secret: string;
  setSecret: (value: string) => void;
  configured: boolean;
  onTest: () => void;
}) {
  return (
    <section className="rounded-lg border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-3">
          <Icon className="mt-0.5 size-4" />
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {description}
            </p>
          </div>
        </div>
        <ConnectionBadge state={state} />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(14rem,.7fr)_auto] md:items-end">
        <label className="grid gap-1.5 text-xs font-semibold">
          MCP URL
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            type="url"
          />
        </label>
        <label className="grid gap-1.5 text-xs font-semibold">
          API key
          <div className="relative">
            <Input
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              type="password"
              placeholder={
                configured ? "Configured · enter to replace" : "Enter API key"
              }
            />
            <EyeOff className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
        </label>
        <Button
          variant="outline"
          onClick={onTest}
          disabled={state === "testing"}
        >
          {state === "testing" ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <PlugZap />
          )}{" "}
          Test
        </Button>
      </div>
    </section>
  );
}

function EmailConnectionBadge({ state }: { state: EmailIntegrationState }) {
  if (!state.configured) return <Badge variant="outline">Not configured</Badge>;
  if (
    state.accounts.some(
      (account) => account.enabled && account.lastConnectionStatus === "error",
    )
  )
    return (
      <Badge variant="destructive">
        <X /> Mailbox issue
      </Badge>
    );
  if (state.status === "connected")
    return (
      <Badge className="border border-accent bg-accent-muted text-success">
        <Check /> Connected
      </Badge>
    );
  if (state.status === "failed")
    return (
      <Badge variant="destructive">
        <X /> Unavailable
      </Badge>
    );
  return <Badge variant="outline">Not tested</Badge>;
}

function ConnectionBadge({ state }: { state: State }) {
  if (state === "idle") return <Badge variant="outline">Not tested</Badge>;
  if (state === "testing")
    return (
      <Badge variant="outline">
        <LoaderCircle className="animate-spin" /> Testing
      </Badge>
    );
  if (state === "connected")
    return (
      <Badge className="border border-accent bg-accent-muted text-success">
        <Check /> Connected
      </Badge>
    );
  return (
    <Badge variant="destructive">
      <X /> Unavailable
    </Badge>
  );
}
