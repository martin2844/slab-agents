"use client";
import { useState } from "react";
import {
  Check,
  EyeOff,
  LoaderCircle,
  PlugZap,
  Save,
  Server,
  TerminalSquare,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/client-api";
import type { SetupStatus, WorkspaceSettings } from "@/lib/types";
type Service = "work" | "docs" | "runner" | "codex";
type State = "idle" | "testing" | "connected" | "error";
export function SettingsView({
  initialSettings,
  initialSetup,
}: {
  initialSettings: WorkspaceSettings;
  initialSetup: SetupStatus;
}) {
  const initialServiceState = (service: Service): State => {
    const value = initialSetup.checks.find((item) => item.service === service)?.state;
    if (value === "connected") return "connected";
    if (value === "failed") return "error";
    return "idle";
  };
  const [settings, setSettings] = useState<WorkspaceSettings | null>(
      initialSettings,
    ),
    [error] = useState(""),
    [workKey, setWorkKey] = useState(""),
    [docsKey, setDocsKey] = useState(""),
    [status, setStatus] = useState<Record<Service, State>>({
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save settings");
    }
  }
  async function test(service: Service) {
    setStatus((v) => ({ ...v, [service]: "testing" }));
    try {
      await persistSettings();
      const result = await api<SetupStatus>(`/api/settings/test`, {
        method: "POST",
        body: JSON.stringify({ service }),
      });
      const check = result.checks.find((item) => item.service === service);
      const next = check?.state === "connected" ? "connected" : "error";
      setStatus((v) => ({ ...v, [service]: next }));
      if (next === "error") throw new Error(check?.detail ?? `${service} is unavailable`);
      if (service === "runner") {
        setStatus((v) => ({ ...v, codex: "testing" }));
        const runtime = await api<SetupStatus>(`/api/settings/test`, {
          method: "POST",
          body: JSON.stringify({ service: "codex" }),
        });
        const codex = runtime.checks.find((item) => item.service === "codex");
        setStatus((v) => ({
          ...v,
          codex: codex?.state === "connected" ? "connected" : "error",
        }));
      }
    } catch (e) {
      setStatus((v) => ({ ...v, [service]: "error" }));
      toast.error(e instanceof Error ? e.message : `${service} is unavailable`);
    }
  }
  if (error) return <ErrorState message={error} />;
  if (!settings) return <LoadingState />;
  return (
    <>
      <PageHeader
        eyebrow="Local configuration"
        title="Settings"
        description="Connection details live in the server-side SQLite database. Secrets are accepted here but never returned to React."
        actions={
          <Button onClick={save}>
            <Save />
            Save changes
          </Button>
        }
      />
      <div className="grid gap-10 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-10">
          {[
            {
              key: "work" as const,
              title: "Slab",
              description: "Operational work via remote MCP.",
              icon: Server,
              url: settings.workMcpUrl,
              setUrl: (value: string) =>
                setSettings({ ...settings, workMcpUrl: value }),
              secret: workKey,
              setSecret: setWorkKey,
              configured: settings.workApiKeyConfigured,
            },
            {
              key: "docs" as const,
              title: "Slab Docs",
              description: "Company knowledge via remote MCP.",
              icon: PlugZap,
              url: settings.docsMcpUrl,
              setUrl: (value: string) =>
                setSettings({ ...settings, docsMcpUrl: value }),
              secret: docsKey,
              setSecret: setDocsKey,
              configured: settings.docsApiKeyConfigured,
            },
          ].map((item) => (
            <section
              key={item.key}
              className="border-t-2 border-foreground pt-5"
            >
              <div className="flex items-start justify-between">
                <div className="flex gap-3">
                  <item.icon className="mt-1 size-5" />
                  <div>
                    <h2 className="font-heading text-3xl font-semibold">
                      {item.title}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                </div>
                <ConnectionBadge state={status[item.key]} />
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <label className="grid gap-2 text-sm font-semibold">
                  MCP URL
                  <Input
                    value={item.url}
                    onChange={(e) => item.setUrl(e.target.value)}
                    type="url"
                  />
                </label>
                <label className="grid gap-2 text-sm font-semibold">
                  API key
                  <div className="relative">
                    <Input
                      value={item.secret}
                      onChange={(e) => item.setSecret(e.target.value)}
                      type="password"
                      placeholder={
                        item.configured
                          ? "Configured · enter to replace"
                          : "Enter API key"
                      }
                    />
                    <EyeOff className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </label>
                <Button
                  variant="outline"
                  onClick={() => test(item.key)}
                  disabled={status[item.key] === "testing"}
                >
                  {status[item.key] === "testing" ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <PlugZap />
                  )}
                  Test connection
                </Button>
              </div>
            </section>
          ))}
          <section className="border-t-2 border-foreground pt-5">
            <div className="flex items-start justify-between">
              <div className="flex gap-3">
                <TerminalSquare className="mt-1 size-5" />
                <div>
                  <h2 className="font-heading text-3xl font-semibold">
                    Runner
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Loopback-only execution service.
                  </p>
                </div>
              </div>
              <ConnectionBadge state={status.runner} />
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="grid gap-2 text-sm font-semibold">
                Runner URL
                <Input
                  value={settings.runnerUrl}
                  onChange={(e) =>
                    setSettings({ ...settings, runnerUrl: e.target.value })
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
          </section>
        </div>
        <aside className="border-t-2 border-primary pt-5">
          <p className="text-xs font-bold uppercase tracking-[.16em] text-primary">
            Security boundary
          </p>
          <h2 className="mt-2 font-heading text-3xl font-semibold leading-tight">
            The browser never sees MCP credentials.
          </h2>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            React talks only to Next route handlers. MCP clients and Runner
            requests execute in the Node.js runtime. Keep Runner bound to
            127.0.0.1.
          </p>
          <div className="mt-6 space-y-3 border-y py-4 text-sm">
            <div className="flex justify-between">
              <span>Single user</span>
              <strong>Local</strong>
            </div>
            <div className="flex justify-between">
              <span>Work source</span>
              <strong>Slab</strong>
            </div>
            <div className="flex justify-between">
              <span>Docs source</span>
              <strong>Slab Docs</strong>
            </div>
            <div className="flex justify-between">
              <span>Agent runtime</span>
              <strong>Codex</strong>
            </div>
          </div>
          <div className="mt-6 space-y-3 text-sm">
            {[
              ["Slab", status.work],
              ["Docs", status.docs],
              ["Runner", status.runner],
              [
                "Codex",
                status.codex === "connected"
                  ? "available"
                  : status.codex === "error"
                    ? "unavailable"
                    : status.codex === "testing"
                      ? "testing"
                      : "not verified",
              ],
            ].map(([label, value]) => (
              <div className="flex items-center justify-between" key={label}>
                <span>{label}</span>
                <span className="font-semibold capitalize text-muted-foreground">
                  {value}
                </span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}
function ConnectionBadge({ state }: { state: State }) {
  if (state === "idle") return <Badge variant="outline">Not tested</Badge>;
  if (state === "testing")
    return (
      <Badge variant="outline">
        <LoaderCircle className="animate-spin" />
        Testing
      </Badge>
    );
  if (state === "connected")
    return (
      <Badge className="bg-emerald-700 text-white">
        <Check />
        Connected
      </Badge>
    );
  return (
    <Badge variant="destructive">
      <X />
      Unavailable
    </Badge>
  );
}
