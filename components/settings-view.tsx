"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  BrainCircuit,
  BellRing,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  EyeOff,
  LoaderCircle,
  KeyRound,
  Mail,
  PlugZap,
  Save,
  Server,
  ShieldCheck,
  TerminalSquare,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { EmailIntegrationEditor } from "@/components/email-integration-editor";
import { CalendarIntegrationEditor } from "@/components/calendar-integration-editor";
import { RuntimeSettings } from "@/components/runtime-settings";
import { BudgetSettings } from "@/components/budget-settings";
import { OperatorNotificationsSettings } from "@/components/operator-notifications-settings";
import { PageHeader } from "@/components/page-header";
import { SettingRow, SettingSection } from "@/components/settings-layout";
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
import { cn } from "@/lib/utils";
import { api } from "@/lib/client-api";
import {
  clearSettingsCallback,
  settingsPageUrl,
  type SettingsPage,
} from "@/lib/settings-navigation";
import type {
  Agent,
  EmailIntegrationState,
  Integration,
  SetupStatus,
  WorkspaceSettings,
  RuntimeCatalogItem,
  BudgetConfiguration,
  OperatorNotificationState,
} from "@/lib/types";

type Service = "work" | "docs" | "runner" | "codex";
type State = "idle" | "testing" | "connected" | "error";

const SETTINGS_PAGES: Record<
  SettingsPage,
  { label: string; description: string }
> = {
  connections: {
    label: "Connections",
    description: "Connect Slab to operational work and company knowledge.",
  },
  operator: {
    label: "Operator",
    description:
      "Configure the human identity and agent responsible for coordination.",
  },
  runtime: {
    label: "Runtime",
    description: "Configure how agents execute work.",
  },
  budgets: {
    label: "Models & budgets",
    description:
      "Control run limits, agent overrides, and model cost accounting.",
  },
  memory: {
    label: "Memory",
    description: "Configure optional durable recall for agent conversations.",
  },
  email: {
    label: "Email",
    description: "Manage mailboxes and agent communication permissions.",
  },
  notifications: {
    label: "Notifications",
    description:
      "Choose how Slab alerts the operator when attention is required.",
  },
  calendar: {
    label: "Calendar",
    description: "Connect schedules and assign calendar access to agents.",
  },
  security: {
    label: "Security",
    description: "Review workspace boundaries and operator access.",
  },
};

const SETTINGS_GROUPS: Array<{
  label: string;
  pages: Array<{ page: SettingsPage; icon: typeof Server }>;
}> = [
  {
    label: "Workspace",
    pages: [
      { page: "connections", icon: PlugZap },
      { page: "operator", icon: UserRound },
    ],
  },
  {
    label: "Agents & runtime",
    pages: [
      { page: "runtime", icon: TerminalSquare },
      { page: "budgets", icon: CircleDollarSign },
      { page: "memory", icon: BrainCircuit },
    ],
  },
  {
    label: "Communication",
    pages: [
      { page: "email", icon: Mail },
      { page: "notifications", icon: BellRing },
      { page: "calendar", icon: CalendarDays },
    ],
  },
  {
    label: "Access",
    pages: [{ page: "security", icon: ShieldCheck }],
  },
];

function editableWorkspaceSettings(settings: WorkspaceSettings) {
  return {
    workMcpUrl: settings.workMcpUrl,
    docsMcpUrl: settings.docsMcpUrl,
    runnerUrl: settings.runnerUrl,
    operatorDisplayName: settings.operatorDisplayName,
    coordinationReviewer: settings.coordinationReviewer,
    memoryProvider: settings.memoryProvider,
    honchoUrl: settings.honchoUrl,
    honchoWorkspaceId: settings.honchoWorkspaceId,
    memoryMaxContextTokens: settings.memoryMaxContextTokens,
  };
}

export function SettingsView({
  initialSettings,
  initialSetup,
  initialEmail,
  initialNotifications,
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
  initialNotifications: OperatorNotificationState;
  initialCalendars: Integration[];
  auth: { required: boolean; configured: boolean };
  agents: Agent[];
  initialTab: SettingsPage;
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
  const [savedSettings, setSavedSettings] = useState(initialSettings);
  const [navigation, setNavigation] = useState({
    initialTab,
    activePage: initialTab,
  });
  const activePage =
    navigation.initialTab === initialTab ? navigation.activePage : initialTab;
  const [saving, setSaving] = useState(false);
  const [managedConnection, setManagedConnection] = useState<
    "work" | "docs" | "runner" | null
  >(null);
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
    setSavedSettings(updated);
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
    setSaving(true);
    try {
      await persistSettings();
      toast.success("Settings saved");
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not save settings",
      );
    } finally {
      setSaving(false);
    }
  }

  function navigate(page: SettingsPage) {
    setNavigation({ initialTab, activePage: page });
    window.history.replaceState(
      null,
      "",
      settingsPageUrl(window.location.href, page),
    );
  }

  function clearCallbackResult(parameter: "email" | "calendar") {
    window.history.replaceState(
      null,
      "",
      clearSettingsCallback(window.location.href, parameter),
    );
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

  const hasUnsavedChanges =
    workKey.length > 0 ||
    docsKey.length > 0 ||
    honchoKey.length > 0 ||
    JSON.stringify(editableWorkspaceSettings(settings)) !==
      JSON.stringify(editableWorkspaceSettings(savedSettings));
  const page = SETTINGS_PAGES[activePage];

  return (
    <>
      <PageHeader
        title="Settings"
        description="Manage how Slab operates. Configuration and credentials stay server-side."
      />
      <div className="grid min-w-0 gap-7 lg:grid-cols-[11.5rem_minmax(0,1fr)] lg:items-start">
        <SettingsNavigation
          activePage={activePage}
          hasWorkspaceChanges={hasUnsavedChanges}
          onNavigate={navigate}
        />
        <main className="min-w-0">
          <div className="mb-5">
            <h2 className="text-xl font-semibold tracking-[-0.025em]">
              {page.label}
            </h2>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              {page.description}
            </p>
          </div>

          {activePage === "connections" ? (
            <SettingSection
              title="Workspace sources"
              description={`${initialSetup.connected}/${initialSetup.total} core systems are currently healthy.`}
            >
              <ConnectionPanel
                title="Work · Slab"
                description="Issues, projects, and operational coordination."
                icon={Server}
                state={status.work}
                url={settings.workMcpUrl}
                setUrl={(value) =>
                  setSettings({ ...settings, workMcpUrl: value })
                }
                secret={workKey}
                setSecret={setWorkKey}
                configured={settings.workApiKeyConfigured}
                onTest={() => test("work")}
                open={managedConnection === "work"}
                onOpenChange={(open) =>
                  setManagedConnection(open ? "work" : null)
                }
              />
              <ConnectionPanel
                title="Docs · Slab Docs"
                description="Company knowledge and durable operating context."
                icon={PlugZap}
                state={status.docs}
                url={settings.docsMcpUrl}
                setUrl={(value) =>
                  setSettings({ ...settings, docsMcpUrl: value })
                }
                secret={docsKey}
                setSecret={setDocsKey}
                configured={settings.docsApiKeyConfigured}
                onTest={() => test("docs")}
                open={managedConnection === "docs"}
                onOpenChange={(open) =>
                  setManagedConnection(open ? "docs" : null)
                }
              />
            </SettingSection>
          ) : null}

          {activePage === "operator" ? (
            <SettingSection
              title="Operator identity"
              description="Identity Slab uses when coordinating this workspace."
            >
              <SettingRow
                title="Display name"
                description="How agents refer to you in operational interactions."
              >
                <Input
                  className="md:max-w-sm"
                  value={settings.operatorDisplayName}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      operatorDisplayName: event.target.value,
                    })
                  }
                />
              </SettingRow>
              <SettingRow
                title="Coordination reviewer"
                description="Agent responsible for resolving coordination issues."
              >
                <Input
                  className="md:max-w-sm"
                  list="coordination-reviewer-options"
                  value={settings.coordinationReviewer}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      coordinationReviewer: event.target.value,
                    })
                  }
                  placeholder="Agent slug, name, or ID"
                />
                <datalist id="coordination-reviewer-options">
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.slug}>
                      {agent.name}
                    </option>
                  ))}
                </datalist>
              </SettingRow>
            </SettingSection>
          ) : null}

          {activePage === "runtime" ? (
            <div className="space-y-7">
              <SettingSection
                title="Execution service"
                description="The private runner that starts and supervises agent runtimes."
              >
                <SettingRow
                  title="Runner"
                  description="Local execution boundary used by every configured runtime."
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <ConnectionBadge state={status.runner} />
                        <span className="font-mono text-xs text-muted-foreground">
                          {settings.runnerUrl}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setManagedConnection(
                            managedConnection === "runner" ? null : "runner",
                          )
                        }
                      >
                        Manage <ChevronRight />
                      </Button>
                    </div>
                    {managedConnection === "runner" ? (
                      <div className="grid gap-3 rounded-md bg-muted p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                        <label className="grid gap-1.5 text-xs font-semibold">
                          Runner URL
                          <Input
                            value={settings.runnerUrl}
                            onChange={(event) =>
                              setSettings({
                                ...settings,
                                runnerUrl: event.target.value,
                              })
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
                          )}
                          Test connection
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </SettingRow>
              </SettingSection>
              <RuntimeSettings initialRuntimes={initialRuntimes} />
            </div>
          ) : null}

          {activePage === "budgets" ? (
            <BudgetSettings
              initialBudget={initialBudget}
              agents={agents}
              runtimes={initialRuntimes}
            />
          ) : null}

          {activePage === "email" ? (
            <SettingSection
              title="Email service"
              description="Connect mailboxes so agents can read, draft, and send according to their permissions."
            >
              <SettingRow
                title={email.configured ? "slab-email" : "Email service"}
                description={
                  email.configured
                    ? `${email.accounts.length} mailboxes · ${email.assignments.length} agent profiles`
                    : "No email service is connected yet."
                }
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <EmailConnectionBadge state={email} />
                  <Button
                    variant="outline"
                    onClick={() => {
                      setGmailCallbackUrl(
                        `${window.location.origin}/api/integrations/email/google/callback`,
                      );
                      setEmailOpen(true);
                    }}
                  >
                    <Mail /> Manage email
                  </Button>
                </div>
              </SettingRow>
              {email.accounts.length > 0 && email.assignments.length === 0 ? (
                <div className="flex flex-col gap-3 py-3.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold">No agent can use Email yet</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Assign a mailbox and permissions to an agent. The
                      capability becomes available on that agent&apos;s next
                      run.
                    </p>
                  </div>
                  <Button variant="outline" onClick={() => setEmailOpen(true)}>
                    Assign agent access
                  </Button>
                </div>
              ) : null}
            </SettingSection>
          ) : null}

          {activePage === "notifications" ? (
            <OperatorNotificationsSettings
              initialState={initialNotifications}
              accounts={email.accounts}
            />
          ) : null}

          {activePage === "calendar" ? (
            <SettingSection
              title="Calendar"
              description="Google, Microsoft, CalDAV, Cal.com, and read-only shared calendars."
            >
              <SettingRow
                title={
                  calendars.length ? "Calendar accounts" : "Calendar service"
                }
                description={
                  calendars.length
                    ? `${calendars.length} accounts · ${
                        new Set(
                          calendars.flatMap((integration) =>
                            Object.keys(integration.permissions),
                          ),
                        ).size
                      } agents with access`
                    : "No calendar provider is connected yet."
                }
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge
                    variant={
                      calendars.some(
                        (integration) =>
                          integration.enabled &&
                          integration.status === "failed",
                      )
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {
                      calendars.filter(
                        (integration) =>
                          integration.enabled &&
                          integration.status === "connected",
                      ).length
                    }{" "}
                    healthy
                  </Badge>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!configuredCalendarCallbackOrigin)
                        setCalendarCallbackOrigin(window.location.origin);
                      setCalendarOpen(true);
                    }}
                  >
                    <CalendarDays /> Manage calendar
                  </Button>
                </div>
              </SettingRow>
              {calendars.length > 0 &&
              calendars.every(
                (integration) =>
                  Object.keys(integration.permissions).length === 0,
              ) ? (
                <div className="flex flex-col gap-3 py-3.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold">
                      No agent can use Calendar yet
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Assign at least one connected account. New permissions
                      apply on the next run.
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
            </SettingSection>
          ) : null}

          {activePage === "memory" ? (
            <SettingSection
              title="Persistent agent memory"
              description="Optional recall for operator preferences and corrections. Work, Docs, and integrations remain sources of truth."
            >
              <SettingRow
                title="Memory provider"
                description="Disabling recall does not delete data already stored by the provider."
              >
                <div className="flex items-center gap-2">
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
                  {settings.memoryProvider === "disabled" ? (
                    <Badge variant="outline">Disabled</Badge>
                  ) : (
                    <ConnectionBadge state={memoryState} />
                  )}
                </div>
              </SettingRow>
              <SettingRow
                title="Honcho connection"
                description="Server-side connection used to store and recall memories."
              >
                <div className="grid gap-3 sm:grid-cols-2">
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
                  <label className="grid gap-1.5 text-xs font-semibold sm:col-span-2">
                    Honcho URL
                    <Input
                      value={settings.honchoUrl}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          honchoUrl: event.target.value,
                        })
                      }
                      type="url"
                      disabled={settings.memoryProvider === "disabled"}
                    />
                  </label>
                  <label className="grid gap-1.5 text-xs font-semibold sm:col-span-2">
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
                </div>
              </SettingRow>
              <SettingRow
                title="Connection test"
                description="Only operator-authored chat messages are recorded; raw tool output is excluded."
              >
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
              </SettingRow>
            </SettingSection>
          ) : null}

          {activePage === "security" ? (
            <div className="space-y-7">
              <SettingSection
                title="Security boundary"
                description={
                  auth.required
                    ? "Credentials remain server-side. The browser communicates only with password-protected Slab route handlers."
                    : "Credentials remain server-side. Browser access is not password protected in this deployment."
                }
              >
                <SettingRow
                  title="Workspace boundary"
                  description="MCP clients and Runner requests execute in the Node.js runtime."
                >
                  <ShieldCheck className="size-5 text-muted-foreground" />
                </SettingRow>
              </SettingSection>
              <SettingSection title="Environment">
                <div className="py-1">
                  <dl className="divide-y text-sm">
                    {[
                      [
                        "Workspace",
                        auth.required
                          ? "Single user · password protected"
                          : "Single user · authentication disabled",
                      ],
                      ["Work source", "Slab"],
                      ["Docs source", "Slab Docs"],
                      ["Agent runtime", "Configured per agent"],
                      ["Runner boundary", connectionLabel(settings.runnerUrl)],
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
                </div>
              </SettingSection>
              {auth.required && auth.configured ? (
                <SettingSection
                  title="Operator password"
                  description="Changing the password signs out the current session."
                >
                  <form
                    onSubmit={changePassword}
                    className="grid gap-3 py-4 sm:grid-cols-3"
                  >
                    <label className="grid gap-1.5 text-xs font-semibold">
                      Current password
                      <Input
                        type="password"
                        autoComplete="current-password"
                        value={currentPassword}
                        onChange={(event) =>
                          setCurrentPassword(event.target.value)
                        }
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
                        onChange={(event) =>
                          setConfirmPassword(event.target.value)
                        }
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
                </SettingSection>
              ) : null}
            </div>
          ) : null}
        </main>
      </div>
      {hasUnsavedChanges &&
      activePage !== "budgets" &&
      activePage !== "notifications" ? (
        <div className="sticky bottom-4 z-20 mt-6 flex justify-center">
          <div className="flex w-full max-w-xl items-center justify-between gap-3 rounded-lg border bg-primary px-3 py-2 text-primary-foreground shadow-lg">
            <span className="text-sm font-medium">Unsaved changes</span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
                onClick={() => {
                  setSettings(savedSettings);
                  setWorkKey("");
                  setDocsKey("");
                  setHonchoKey("");
                }}
              >
                Discard
              </Button>
              <Button variant="signal" onClick={save} disabled={saving}>
                {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
                Save changes
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <EmailIntegrationEditor
        open={emailOpen}
        initialState={email}
        agents={agents}
        gmailCallbackUrl={gmailCallbackUrl}
        microsoftCallbackUrl={gmailCallbackUrl.replace(
          "/google/callback",
          "/microsoft/callback",
        )}
        onOpenChange={(next) => {
          setEmailOpen(next);
          if (!next) clearCallbackResult("email");
        }}
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
            clearCallbackResult("calendar");
          }
        }}
        onUpdated={setCalendars}
      />
    </>
  );
}

function SettingsNavigation({
  activePage,
  hasWorkspaceChanges,
  onNavigate,
}: {
  activePage: SettingsPage;
  hasWorkspaceChanges: boolean;
  onNavigate: (page: SettingsPage) => void;
}) {
  return (
    <nav
      aria-label="Settings sections"
      className="-mx-1 flex w-full min-w-0 max-w-full gap-1 overflow-x-auto px-1 pb-2 lg:sticky lg:top-4 lg:mx-0 lg:block lg:overflow-visible lg:px-0 lg:pb-0"
    >
      {SETTINGS_GROUPS.map((group) => (
        <div key={group.label} className="shrink-0 lg:mb-5">
          <p className="mb-1.5 hidden px-2 font-mono text-[0.65rem] font-medium uppercase tracking-[0.04em] text-muted-foreground lg:block">
            {group.label}
          </p>
          <div className="flex gap-1 lg:block lg:space-y-0.5">
            {group.pages.map(({ page, icon: Icon }) => {
              const active = activePage === page;
              return (
                <button
                  key={page}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => onNavigate(page)}
                  className={cn(
                    "flex h-8 w-full items-center gap-2 whitespace-nowrap rounded-md px-2.5 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {SETTINGS_PAGES[page].label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {hasWorkspaceChanges ? (
        <button
          type="button"
          onClick={() => onNavigate("connections")}
          className="flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground lg:w-full"
        >
          <span className="size-1.5 rounded-full bg-accent" />
          Unsaved workspace changes
        </button>
      ) : null}
    </nav>
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
  open,
  onOpenChange,
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <SettingRow title={title} description={description}>
      <div className="space-y-3">
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 max-w-full items-center gap-2">
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <ConnectionBadge state={state} />
            <span className="truncate font-mono text-xs text-muted-foreground">
              {connectionLabel(url)}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 sm:ml-0"
            onClick={() => onOpenChange(!open)}
            aria-expanded={open}
          >
            Manage <ChevronRight className={cn(open && "rotate-90")} />
          </Button>
        </div>
        {open ? (
          <div className="grid gap-3 rounded-md bg-muted p-3 md:grid-cols-[minmax(0,1fr)_minmax(12rem,.7fr)_auto] md:items-end">
            <label className="grid gap-1.5 text-xs font-semibold">
              MCP endpoint
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                type="url"
              />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold">
              Credential
              <div className="relative">
                <Input
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  type="password"
                  placeholder={
                    configured
                      ? "Configured · enter to replace"
                      : "Enter API key"
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
              )}
              Test
            </Button>
          </div>
        ) : null}
      </div>
    </SettingRow>
  );
}

function connectionLabel(value: string) {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.port ? `:${url.port}` : ""}`;
  } catch {
    return value || "Not configured";
  }
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
