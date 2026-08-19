"use client";

import { useState } from "react";
import {
  Check,
  EyeOff,
  LoaderCircle,
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
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/client-api";
import type {
  Agent,
  EmailIntegrationState,
  SetupStatus,
  WorkspaceSettings,
} from "@/lib/types";

type Service = "work" | "docs" | "runner" | "codex";
type State = "idle" | "testing" | "connected" | "error";

export function SettingsView({
  initialSettings,
  initialSetup,
  initialEmail,
  agents,
}: {
  initialSettings: WorkspaceSettings;
  initialSetup: SetupStatus;
  initialEmail: EmailIntegrationState;
  agents: Agent[];
}) {
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
  const [email, setEmail] = useState(initialEmail);
  const [emailOpen, setEmailOpen] = useState(false);
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
      }),
    });
    setSettings(updated);
    setWorkKey("");
    setDocsKey("");
    return updated;
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
      <Tabs defaultValue="sources" className="space-y-5">
        <TabsList className="h-9 w-full justify-start overflow-x-auto rounded-lg border bg-card p-1 sm:w-auto">
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="runtime">Runtime</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>

        <TabsContent value="sources" className="space-y-4">
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
            <div className="mt-4 flex min-h-11 items-center justify-between border-y text-sm">
              <span>Codex runtime</span>
              <ConnectionBadge state={status.codex} />
            </div>
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
              <Button variant="outline" onClick={() => setEmailOpen(true)}>
                <Mail /> Configure email
              </Button>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="security">
          <section className="max-w-3xl rounded-lg border bg-card p-4 sm:p-5">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 size-4 text-emerald-700" />
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
                ["Agent runtime", "Codex"],
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
          </section>
        </TabsContent>
      </Tabs>
      <EmailIntegrationEditor
        open={emailOpen}
        initialState={email}
        agents={agents}
        onOpenChange={setEmailOpen}
        onUpdated={setEmail}
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
      <Badge className="bg-emerald-700 text-white">
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
      <Badge className="bg-emerald-700 text-white">
        <Check /> Connected
      </Badge>
    );
  return (
    <Badge variant="destructive">
      <X /> Unavailable
    </Badge>
  );
}
