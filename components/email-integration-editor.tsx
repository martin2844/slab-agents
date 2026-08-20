"use client";

import { useMemo, useState } from "react";
import {
  Check,
  KeyRound,
  LoaderCircle,
  Mail,
  MailCheck,
  Pencil,
  Power,
  RefreshCw,
  Send,
  Server,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
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
import type {
  Agent,
  AgentEmailAccess,
  EmailIntegrationState,
  EmailSendPolicy,
} from "@/lib/types";

type ProtonForm = {
  emailAddress: string;
  displayName: string;
  imapHost: string;
  imapPort: string;
  imapTlsMode: "ssl" | "starttls" | "none";
  smtpHost: string;
  smtpPort: string;
  smtpTlsMode: "ssl" | "starttls" | "none";
  username: string;
  password: string;
};

const emptyProton: ProtonForm = {
  emailAddress: "",
  displayName: "",
  imapHost: "127.0.0.1",
  imapPort: "1143",
  imapTlsMode: "starttls",
  smtpHost: "127.0.0.1",
  smtpPort: "1025",
  smtpTlsMode: "starttls",
  username: "",
  password: "",
};

export function EmailMark() {
  return (
    <div className="grid size-12 place-items-center rounded-xl border bg-background shadow-sm">
      <Mail className="size-6 text-primary" />
    </div>
  );
}

export function EmailIntegrationEditor({
  open,
  initialState,
  agents,
  gmailCallbackUrl,
  onOpenChange,
  onUpdated,
}: {
  open: boolean;
  initialState: EmailIntegrationState;
  agents: Agent[];
  gmailCallbackUrl: string;
  onOpenChange: (open: boolean) => void;
  onUpdated: (state: EmailIntegrationState) => void;
}) {
  const [state, setState] = useState(initialState);
  const [serviceUrl, setServiceUrl] = useState(initialState.serviceUrl);
  const [gmailClientId, setGmailClientId] = useState(
    initialState.gmailOAuth.clientId,
  );
  const [gmailClientSecret, setGmailClientSecret] = useState("");
  const [proton, setProton] = useState(emptyProton);
  const [showProton, setShowProton] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function update(next: EmailIntegrationState) {
    setState(next);
    setServiceUrl(next.serviceUrl);
    setGmailClientId(next.gmailOAuth.clientId);
    onUpdated(next);
  }

  async function saveGmailOAuth() {
    setBusy("gmail-oauth");
    try {
      const next = await api<EmailIntegrationState>(
        "/api/integrations/email/gmail/settings",
        {
          method: "PATCH",
          body: JSON.stringify({
            clientId: gmailClientId,
            ...(gmailClientSecret ? { clientSecret: gmailClientSecret } : {}),
          }),
        },
      );
      update(next);
      toast.success("Google OAuth credentials saved");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Google OAuth credentials could not be saved",
      );
    } finally {
      setGmailClientSecret("");
      setBusy(null);
    }
  }

  async function saveConnection() {
    setBusy("connection");
    try {
      const next = await api<EmailIntegrationState>("/api/integrations/email", {
        method: "PATCH",
        body: JSON.stringify({ serviceUrl }),
      });
      update(next);
      if (next.status === "connected") toast.success("Email service connected");
      else toast.error(next.lastError ?? "Email service connection failed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Connection failed");
    } finally {
      setBusy(null);
    }
  }

  async function createProton() {
    setBusy("proton");
    try {
      const result = await api<{ state: EmailIntegrationState }>(
        "/api/integrations/email/accounts",
        {
          method: "POST",
          body: JSON.stringify({ provider: "proton-bridge", ...proton }),
        },
      );
      update(result.state);
      setProton(emptyProton);
      setShowProton(false);
      toast.success("Proton Bridge account connected");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Account could not be created",
      );
    } finally {
      setBusy(null);
    }
  }

  function startCreateProton() {
    setEditingAccountId(null);
    setProton(emptyProton);
    setShowProton(true);
  }

  function startEditAccount(account: EmailIntegrationState["accounts"][number]) {
    setEditingAccountId(account.id);
    setProton({
      emailAddress: account.emailAddress,
      displayName: account.displayName,
      imapHost: account.connection.imapHost,
      imapPort: String(account.connection.imapPort),
      imapTlsMode: account.connection.imapTlsMode,
      smtpHost: account.connection.smtpHost,
      smtpPort: String(account.connection.smtpPort),
      smtpTlsMode: account.connection.smtpTlsMode,
      username: "",
      password: "",
    });
    setShowProton(true);
  }

  async function updateAccount() {
    if (!editingAccountId) return;
    setBusy("account-edit");
    try {
      const result = await api<{
        state: EmailIntegrationState;
      }>(`/api/integrations/email/accounts/${editingAccountId}`, {
        method: "PATCH",
        body: JSON.stringify({
          displayName: proton.displayName,
          imapHost: proton.imapHost,
          imapPort: proton.imapPort,
          imapTlsMode: proton.imapTlsMode,
          smtpHost: proton.smtpHost,
          smtpPort: proton.smtpPort,
          smtpTlsMode: proton.smtpTlsMode,
          ...(proton.username ? { username: proton.username } : {}),
          ...(proton.password ? { password: proton.password } : {}),
        }),
      });
      update(result.state);
      setEditingAccountId(null);
      setShowProton(false);
      setProton(emptyProton);
      toast.success("Email account updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Account could not be updated",
      );
    } finally {
      setBusy(null);
    }
  }

  async function connectGmail() {
    setBusy("gmail");
    try {
      const result = await api<{ authorizationUrl: string }>(
        "/api/integrations/email/gmail/connect",
        { method: "POST" },
      );
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      setBusy(null);
      toast.error(
        error instanceof Error ? error.message : "Gmail connection failed",
      );
    }
  }

  async function accountAction(
    accountId: string,
    action: "test" | "toggle" | "delete",
    enabled?: boolean,
  ) {
    setBusy(`${action}:${accountId}`);
    try {
      if (action === "test") {
        const result = await api<{
          status: "ok" | "error";
          latencyMs: number;
          message?: string;
          connectionStatus?: string | null;
        }>(
          `/api/integrations/email/accounts/${accountId}/test`,
          { method: "POST" },
        );
        update(await api<EmailIntegrationState>("/api/integrations/email"));
        if (result.status !== "ok") {
          toast.error(
            result.message ??
              result.connectionStatus ??
              "Mailbox connection failed",
          );
          return;
        }
        toast.success(`Mailbox connected in ${result.latencyMs} ms`);
      } else if (action === "toggle") {
        update(
          await api<EmailIntegrationState>(
            `/api/integrations/email/accounts/${accountId}/status`,
            { method: "POST", body: JSON.stringify({ enabled }) },
          ),
        );
      } else {
        update(
          await api<EmailIntegrationState>(
            `/api/integrations/email/accounts/${accountId}`,
            { method: "DELETE" },
          ),
        );
        toast.success("Email account deleted");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Account action failed",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b p-5 pr-14">
          <div className="flex items-center gap-3">
            <EmailMark />
            <div>
              <DialogTitle className="text-2xl">Email</DialogTitle>
              <DialogDescription>
                Optional workspace email. Connect mailboxes server-side, then
                issue one scoped profile per agent.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-5">
          <section className="border-b py-5">
            <div className="flex items-center gap-2">
              <Server className="size-4" />
              <h3 className="font-semibold">Email service</h3>
              <Badge
                variant={state.status === "connected" ? "default" : "outline"}
              >
                {state.status.replace("_", " ")}
              </Badge>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Input
                value={serviceUrl}
                onChange={(event) => setServiceUrl(event.target.value)}
                placeholder="http://127.0.0.1:6981"
                aria-label="Email service URL"
              />
              <Button onClick={saveConnection} disabled={busy === "connection"}>
                {busy === "connection" ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <RefreshCw />
                )}
                Save & test
              </Button>
            </div>
            {!state.adminConfigured && (
              <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
                Set <code>SLAB_EMAIL_ADMIN_KEY</code> in the slab-agents server
                environment. It is never sent to this page.
              </p>
            )}
          </section>

          <section className="border-b py-5">
            <div className="flex flex-wrap items-center gap-2">
              <MailCheck className="size-4" />
              <h3 className="font-semibold">Google OAuth</h3>
              <Badge
                variant={state.gmailOAuth.configured ? "default" : "outline"}
              >
                {state.gmailOAuth.configured ? "Configured" : "Required"}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Create a Google Cloud OAuth client for a Web application and add
              the exact redirect URI below. The client secret is encrypted by
              slab-email and is never returned to this page.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field
                label="Google client ID"
                value={gmailClientId}
                onChange={setGmailClientId}
                autoComplete="off"
              />
              <Field
                label={
                  state.gmailOAuth.source === "stored"
                    ? "Replace client secret (optional)"
                    : "Google client secret"
                }
                type="password"
                value={gmailClientSecret}
                onChange={setGmailClientSecret}
                autoComplete="new-password"
              />
            </div>
            <label className="mt-3 grid gap-1.5 text-xs font-semibold">
              Authorized redirect URI
              <Input
                value={gmailCallbackUrl}
                readOnly
                aria-label="Google OAuth redirect URI"
              />
            </label>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {state.gmailOAuth.source === "environment"
                  ? "Currently supplied by the slab-email environment. Saving here moves configuration to encrypted service storage."
                  : state.gmailOAuth.updatedAt
                    ? `Updated ${new Date(state.gmailOAuth.updatedAt).toISOString().replace("T", " ").slice(0, 19)} UTC`
                    : "OAuth must be configured before connecting a Gmail mailbox."}
              </p>
              <Button
                variant="outline"
                onClick={saveGmailOAuth}
                disabled={
                  busy === "gmail-oauth" ||
                  !gmailClientId.trim() ||
                  (state.gmailOAuth.source !== "stored" &&
                    !gmailClientSecret.trim())
                }
              >
                {busy === "gmail-oauth" ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <ShieldCheck />
                )}
                Save OAuth credentials
              </Button>
            </div>
          </section>

          <section className="border-b py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">Mailboxes</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Credentials pass once to the Next.js backend and are stored
                  only by slab-email.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={startCreateProton}
                >
                  <KeyRound /> Proton Bridge
                </Button>
                <Button
                  variant="outline"
                  onClick={connectGmail}
                  disabled={
                    !state.configured ||
                    !state.gmailOAuth.configured ||
                    busy === "gmail"
                  }
                >
                  <MailCheck /> Connect Gmail
                </Button>
              </div>
            </div>

            {showProton && (
              <div className="mt-4 rounded-xl border bg-muted/25 p-4">
                <div className="mb-4">
                  <h4 className="font-semibold">
                    {editingAccountId
                      ? "Edit mailbox connection"
                      : "Connect Proton Bridge"}
                  </h4>
                  {editingAccountId && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Leave username and password empty to keep the stored
                      credentials.
                    </p>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Email address"
                    value={proton.emailAddress}
                    onChange={(emailAddress) =>
                      setProton((value) => ({ ...value, emailAddress }))
                    }
                    disabled={editingAccountId !== null}
                  />
                  <Field
                    label="Display name"
                    value={proton.displayName}
                    onChange={(displayName) =>
                      setProton((value) => ({ ...value, displayName }))
                    }
                  />
                  <Field
                    label="Bridge username"
                    value={proton.username}
                    onChange={(username) =>
                      setProton((value) => ({ ...value, username }))
                    }
                    autoComplete="off"
                  />
                  <Field
                    label="Bridge password"
                    type="password"
                    value={proton.password}
                    onChange={(password) =>
                      setProton((value) => ({ ...value, password }))
                    }
                    autoComplete="new-password"
                  />
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_7rem_9rem]">
                  <Field
                    label="IMAP host"
                    value={proton.imapHost}
                    onChange={(imapHost) =>
                      setProton((value) => ({ ...value, imapHost }))
                    }
                  />
                  <Field
                    label="Port"
                    value={proton.imapPort}
                    onChange={(imapPort) =>
                      setProton((value) => ({ ...value, imapPort }))
                    }
                  />
                  <TlsSelect
                    label="IMAP TLS"
                    value={proton.imapTlsMode}
                    onChange={(imapTlsMode) =>
                      setProton((value) => ({ ...value, imapTlsMode }))
                    }
                  />
                  <Field
                    label="SMTP host"
                    value={proton.smtpHost}
                    onChange={(smtpHost) =>
                      setProton((value) => ({ ...value, smtpHost }))
                    }
                  />
                  <Field
                    label="Port"
                    value={proton.smtpPort}
                    onChange={(smtpPort) =>
                      setProton((value) => ({ ...value, smtpPort }))
                    }
                  />
                  <TlsSelect
                    label="SMTP TLS"
                    value={proton.smtpTlsMode}
                    onChange={(smtpTlsMode) =>
                      setProton((value) => ({ ...value, smtpTlsMode }))
                    }
                  />
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setShowProton(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={editingAccountId ? updateAccount : createProton}
                    disabled={
                      busy === "proton" || busy === "account-edit" ||
                      !proton.emailAddress ||
                      (!editingAccountId && !proton.password)
                    }
                  >
                    {busy === "proton" || busy === "account-edit" ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <Check />
                    )}
                    {editingAccountId ? "Save changes" : "Connect account"}
                  </Button>
                </div>
              </div>
            )}

            <div className="mt-4 divide-y rounded-xl border">
              {state.accounts.length ? (
                state.accounts.map((account) => (
                  <div
                    key={account.id}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{account.displayName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {account.emailAddress} ·{" "}
                        {account.provider.replace("_", " ")}
                      </p>
                    </div>
                    <Badge variant={account.enabled ? "outline" : "secondary"}>
                      {account.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                    <MailboxConnectionBadge
                      status={account.lastConnectionStatus}
                    />
                    <div className="flex gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Edit account"
                        onClick={() => startEditAccount(account)}
                        disabled={busy !== null}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => accountAction(account.id, "test")}
                        disabled={busy !== null}
                      >
                        <RefreshCw /> Test
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={
                          account.enabled ? "Disable account" : "Enable account"
                        }
                        onClick={() =>
                          accountAction(account.id, "toggle", !account.enabled)
                        }
                        disabled={busy !== null}
                      >
                        <Power />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Delete account"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete ${account.displayName}? This removes its credentials from slab-email.`,
                            )
                          ) {
                            void accountAction(account.id, "delete");
                          }
                        }}
                        disabled={busy !== null}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    {account.provider === "proton_bridge" &&
                      account.lastConnectionStatus === "error" &&
                      ["127.0.0.1", "localhost", "[::1]"].includes(
                        account.connection.imapHost,
                      ) && (
                        <p className="text-xs leading-5 text-amber-700 sm:basis-full dark:text-amber-300">
                          Bridge on Windows is not reachable from WSL NAT through
                          127.0.0.1. Enable WSL mirrored networking or run
                          slab-email on Windows beside Bridge.
                        </p>
                      )}
                  </div>
                ))
              ) : (
                <p className="p-5 text-sm text-muted-foreground">
                  No mailboxes connected yet.
                </p>
              )}
            </div>
          </section>

          <section className="py-5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4" />
              <h3 className="font-semibold">Agent access profiles</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Each agent receives only a scoped connector token. Raw tokens
              never enter the control-plane database or browser.
            </p>
            <div className="mt-4 divide-y rounded-xl border">
              {agents.map((agent) => (
                <AgentAccessRow
                  key={agent.id}
                  agent={agent}
                  accounts={state.accounts}
                  access={state.assignments.find(
                    ({ agentId }) => agentId === agent.id,
                  )}
                  onSaved={(saved) =>
                    update({
                      ...state,
                      assignments: [
                        ...state.assignments.filter(
                          ({ agentId }) => agentId !== saved.agentId,
                        ),
                        saved,
                      ],
                    })
                  }
                  onRevoked={(next) => update(next)}
                />
              ))}
            </div>
          </section>
        </div>

        <DialogFooter className="m-0 rounded-none border-t px-5">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MailboxConnectionBadge({ status }: { status: string | null }) {
  if (status === "ok")
    return (
      <Badge className="bg-emerald-700 text-white">
        <Check /> Connected
      </Badge>
    );
  if (status === "error")
    return <Badge variant="destructive">Connection failed</Badge>;
  return <Badge variant="outline">Not tested</Badge>;
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  disabled?: boolean;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold">
      {label}
      <Input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        disabled={disabled}
      />
    </label>
  );
}

function TlsSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: "ssl" | "starttls" | "none";
  onChange: (value: "ssl" | "starttls" | "none") => void;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold">
      {label}
      <Select
        value={value}
        onValueChange={(next) => onChange(next as typeof value)}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ssl">SSL</SelectItem>
          <SelectItem value="starttls">STARTTLS</SelectItem>
          <SelectItem value="none">None</SelectItem>
        </SelectContent>
      </Select>
    </label>
  );
}

function AgentAccessRow({
  agent,
  accounts,
  access,
  onSaved,
  onRevoked,
}: {
  agent: Agent;
  accounts: EmailIntegrationState["accounts"];
  access?: AgentEmailAccess;
  onSaved: (access: AgentEmailAccess) => void;
  onRevoked: (state: EmailIntegrationState) => void;
}) {
  const [accountIds, setAccountIds] = useState(access?.accountIds ?? []);
  const [readEnabled, setReadEnabled] = useState(access?.readEnabled ?? true);
  const [draftEnabled, setDraftEnabled] = useState(
    access?.draftEnabled ?? true,
  );
  const [sendEnabled, setSendEnabled] = useState(access?.sendEnabled ?? true);
  const [sendPolicy, setSendPolicy] = useState<EmailSendPolicy>(
    access?.sendPolicy ?? "approval_required",
  );
  const [saving, setSaving] = useState(false);
  const summary = useMemo(
    () =>
      accountIds.length
        ? `${accountIds.length} account${accountIds.length === 1 ? "" : "s"}`
        : "Not configured",
    [accountIds],
  );

  async function save() {
    setSaving(true);
    try {
      const saved = await api<AgentEmailAccess>(
        `/api/integrations/email/agents/${agent.id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            accountIds,
            readEnabled,
            draftEnabled,
            sendEnabled,
            sendPolicy,
          }),
        },
      );
      onSaved(saved);
      toast.success(`${agent.name} Email access updated`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Profile could not be saved",
      );
    } finally {
      setSaving(false);
    }
  }

  async function revoke() {
    setSaving(true);
    try {
      const next = await api<EmailIntegrationState>(
        `/api/integrations/email/agents/${agent.id}`,
        { method: "DELETE" },
      );
      onRevoked(next);
      toast.success(`${agent.name} Email token revoked`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Token could not be revoked",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{agent.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {agent.role} · {summary}
          </p>
        </div>
        {access && <Badge variant="outline">Token {access.tokenPrefix}…</Badge>}
        {access && (
          <Button variant="ghost" size="sm" onClick={revoke} disabled={saving}>
            <Trash2 /> Revoke
          </Button>
        )}
        <Button
          size="sm"
          onClick={save}
          disabled={saving || accountIds.length === 0}
        >
          {saving ? <LoaderCircle className="animate-spin" /> : <Check />} Save
          profile
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {accounts.map((account) => (
          <label
            key={account.id}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold"
          >
            <Switch
              size="sm"
              checked={accountIds.includes(account.id)}
              onCheckedChange={(checked) =>
                setAccountIds((current) =>
                  checked
                    ? [...new Set([...current, account.id])]
                    : current.filter((id) => id !== account.id),
                )
              }
            />
            {account.displayName}
          </label>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex items-center justify-between rounded-lg bg-muted/50 p-3 text-sm font-semibold">
          Read{" "}
          <Switch
            size="sm"
            checked={readEnabled}
            onCheckedChange={setReadEnabled}
          />
        </label>
        <label className="flex items-center justify-between rounded-lg bg-muted/50 p-3 text-sm font-semibold">
          Draft{" "}
          <Switch
            size="sm"
            checked={draftEnabled}
            onCheckedChange={setDraftEnabled}
          />
        </label>
        <label className="flex items-center justify-between rounded-lg bg-muted/50 p-3 text-sm font-semibold">
          Send{" "}
          <Switch
            size="sm"
            checked={sendEnabled}
            onCheckedChange={(checked) => {
              setSendEnabled(checked);
              if (!checked) setSendPolicy("disabled");
              else if (sendPolicy === "disabled")
                setSendPolicy("approval_required");
            }}
          />
        </label>
        <label className="grid gap-1.5 rounded-lg bg-muted/50 p-3 text-xs font-semibold">
          <span className="flex items-center gap-1.5">
            <Send className="size-3.5" /> Send policy
          </span>
          <Select
            value={sendPolicy}
            onValueChange={(value) => {
              const policy = value as EmailSendPolicy;
              setSendPolicy(policy);
              setSendEnabled(policy !== "disabled");
            }}
          >
            <SelectTrigger className="w-full bg-background">
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
      </div>
    </div>
  );
}
