"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  PlugZap,
  ShieldCheck,
  Trash2,
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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/client-api";
import type {
  Agent,
  GmailOAuthSettings,
  Integration,
  IntegrationCatalogItem,
} from "@/lib/types";

export function GoogleDataIntegrationEditor({
  open,
  integration,
  agents,
  catalog,
  callbackOrigin,
  onOpenChange,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  integration?: Integration;
  agents: Agent[];
  catalog: IntegrationCatalogItem;
  callbackOrigin: string;
  onOpenChange: (open: boolean) => void;
  onSaved: (integration: Integration) => void;
  onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState(integration?.name ?? catalog.name);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [reuseGmailOAuthCredentials, setReuseGmailOAuthCredentials] =
    useState(false);
  const [gmailOAuth, setGmailOAuth] = useState<GmailOAuthSettings | null>(null);
  const [enabled, setEnabled] = useState(integration?.enabled ?? true);
  const [permissions, setPermissions] = useState<Record<string, string[]>>(
    integration?.permissions ?? {},
  );
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const enabledAgentCount = useMemo(
    () => Object.values(permissions).filter((tools) => tools.length > 0).length,
    [permissions],
  );

  useEffect(() => {
    if (!open) return;
    let active = true;
    api<GmailOAuthSettings>("/api/integrations/email/gmail/settings")
      .then((settings) => {
        if (active) setGmailOAuth(settings);
      })
      .catch(() => {
        if (active) setGmailOAuth(null);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const callbackUrl = callbackOrigin
    ? new URL("/api/integrations/google-data/callback", callbackOrigin).toString()
    : "/api/integrations/google-data/callback";

  function setTool(agentId: string, toolKey: string, checked: boolean) {
    setPermissions((current) => {
      const existing = current[agentId] ?? [];
      return {
        ...current,
        [agentId]: checked
          ? [...new Set([...existing, toolKey])]
          : existing.filter((key) => key !== toolKey),
      };
    });
  }

  function setAllTools(agentId: string, checked: boolean) {
    setPermissions((current) => ({
      ...current,
      [agentId]: checked ? catalog.tools.map(({ key }) => key) : [],
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const next = await api<Integration>(
        integration
          ? `/api/integrations/google-data/${integration.id}`
          : "/api/integrations/google-data",
        {
          method: integration ? "PATCH" : "POST",
          body: JSON.stringify({
            provider: catalog.provider,
            name,
            clientId: clientId || undefined,
            clientSecret: clientSecret || undefined,
            reuseGmailOAuthCredentials: reuseGmailOAuthCredentials || undefined,
            enabled,
            permissions,
            ...(integration
              ? { expectedVersion: integration.version }
              : {}),
          }),
        },
      );
      onSaved(next);
      setClientId("");
      setClientSecret("");
      setReuseGmailOAuthCredentials(false);
      toast.success(
        next.status === "connected"
          ? `${next.name} settings saved`
          : "Configuration saved. Connect the Google account to finish.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not save Google integration",
      );
    } finally {
      setSaving(false);
    }
  }

  async function connect() {
    if (!integration) {
      toast.error("Save the OAuth configuration first");
      return;
    }
    setConnecting(true);
    try {
      const result = await api<{ authorizationUrl: string }>(
        `/api/integrations/google-data/${integration.id}/oauth`,
        { method: "POST" },
      );
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not start Google OAuth",
      );
      setConnecting(false);
    }
  }

  async function remove() {
    if (!integration) return;
    setDeleting(true);
    try {
      await api(`/api/integrations/${integration.id}`, {
        method: "DELETE",
        body: JSON.stringify({ expectedVersion: integration.version }),
      });
      onDeleted(integration.id);
      toast.success(`${integration.name} deleted`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete integration",
      );
      setDeleting(false);
    }
  }

  const assignedAgents = agents.filter(
    (agent) => (integration?.permissions[agent.id] ?? []).length > 0,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:h-auto sm:max-w-2xl">
        <DialogHeader className="border-b p-5 pr-14">
          <DialogTitle className="text-2xl">
            {integration ? `Edit ${catalog.name}` : `Connect ${catalog.name}`}
          </DialogTitle>
          <DialogDescription>
            Read-only Google data, scoped to the tools and agents you enable.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-5 py-1">
          <section className="border-b py-5">
            <div className="mb-4 flex items-center gap-2">
              <KeyRound className="size-4" />
              <h3 className="font-semibold">Google OAuth connection</h3>
            </div>
            {integration ? (
              <label className="mb-4 flex items-center justify-between rounded-lg border p-3 text-sm font-semibold">
                Integration enabled
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </label>
            ) : null}
            <label className="grid gap-2 text-sm font-semibold">
              Name
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            {gmailOAuth?.configured && gmailOAuth.hasClientSecret ? (
              <div className="mt-4 flex flex-col gap-3 rounded-lg border bg-muted/35 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    {reuseGmailOAuthCredentials ? (
                      <Check className="size-4 text-primary" />
                    ) : (
                      <KeyRound className="size-4 text-muted-foreground" />
                    )}
                    {reuseGmailOAuthCredentials
                      ? "Reusing Gmail OAuth credentials"
                      : "Gmail OAuth credentials are configured"}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Copies only the Google Cloud client ID and secret
                    server-side. You&apos;ll authorize this integration separately;
                    its API and redirect URI must also be enabled in Google Cloud.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => {
                    setReuseGmailOAuthCredentials((current) => !current);
                    setClientId("");
                    setClientSecret("");
                  }}
                >
                  {reuseGmailOAuthCredentials
                    ? "Use different credentials"
                    : "Reuse Gmail credentials"}
                </Button>
              </div>
            ) : null}
            {!reuseGmailOAuthCredentials ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-semibold">
                  OAuth client ID
                  <Input
                    value={clientId}
                    onChange={(event) => {
                      setClientId(event.target.value);
                      setReuseGmailOAuthCredentials(false);
                    }}
                    placeholder={integration?.hasSecret ? "Configured · enter to replace" : "…apps.googleusercontent.com"}
                    autoComplete="off"
                  />
                </label>
                <label className="grid gap-2 text-sm font-semibold">
                  OAuth client secret
                  <Input
                    type="password"
                    value={clientSecret}
                    onChange={(event) => {
                      setClientSecret(event.target.value);
                      setReuseGmailOAuthCredentials(false);
                    }}
                    placeholder={integration?.hasSecret ? "Configured · enter to replace" : "GOCSPX-…"}
                    autoComplete="new-password"
                  />
                </label>
              </div>
            ) : null}
            <label className="mt-4 grid gap-2 text-sm font-semibold">
              Authorized redirect URI
              <Input value={callbackUrl} readOnly className="font-mono text-xs" />
            </label>
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-xs leading-5 text-muted-foreground">
              <LockKeyhole className="mt-0.5 size-4 shrink-0" />
              <span>
                Create a Google OAuth Web application, enable the relevant API,
                and add the redirect URI above. Client secrets and refresh
                tokens are encrypted server-side and never enter agent prompts,
                tool arguments, profiling, or browser responses.
              </span>
            </div>
            {integration ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button onClick={connect} disabled={connecting || saving}>
                  {connecting ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <ExternalLink />
                  )}
                  {connecting
                    ? "Opening Google…"
                    : integration.status === "connected"
                      ? "Reconnect Google"
                      : "Connect Google"}
                </Button>
                {integration.accountEmail ? (
                  <span className="text-xs text-muted-foreground">
                    Connected account: {integration.accountEmail}
                  </span>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-4" />
                  <h3 className="font-semibold">Agent tool access</h3>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Only selected read-only tools enter an agent&apos;s run-scoped
                  capability snapshot.
                </p>
              </div>
              <Badge variant="outline">{enabledAgentCount} enabled</Badge>
            </div>
            <div className="mt-4 divide-y rounded-lg border">
              {agents.length ? (
                agents.map((agent) => {
                  const tools = permissions[agent.id] ?? [];
                  const allEnabled = catalog.tools.every(({ key }) =>
                    tools.includes(key),
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
                            aria-label={`Give ${agent.name} all ${catalog.name} tools`}
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
                              checked={tools.includes(tool.key)}
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
                <p className="p-5 text-sm text-muted-foreground">
                  Create an agent first, then return here to assign tools.
                </p>
              )}
            </div>
          </section>
        </div>

        <DialogFooter className="m-0 rounded-none px-5">
          {integration ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={deleting} className="mr-auto">
                  <Trash2 /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {integration.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {assignedAgents.length
                      ? `Access will be removed from ${assignedAgents.map(({ name: agentName }) => agentName).join(", ")}. Historical runs keep their audit metadata.`
                      : "Historical runs keep their audit metadata. This cannot be undone."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={remove} disabled={deleting}>
                    {deleting ? "Deleting…" : "Delete integration"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={
              saving ||
              !name.trim() ||
              (!integration &&
                !reuseGmailOAuthCredentials &&
                (!clientId.trim() || !clientSecret))
            }
          >
            {saving ? <LoaderCircle className="animate-spin" /> : <PlugZap />}
            {saving ? "Saving…" : "Save configuration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
