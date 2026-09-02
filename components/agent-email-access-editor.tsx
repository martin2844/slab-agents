"use client";

import { useMemo, useState } from "react";
import { Check, LoaderCircle, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { api } from "@/lib/client-api";
import type {
  Agent,
  AgentEmailAccess,
  EmailIntegrationState,
  EmailSendPolicy,
} from "@/lib/types";

export function AgentEmailAccessEditor({
  agent,
  accounts,
  access,
  showAgentIdentity = true,
  onSaved,
  onRevoked,
}: {
  agent: Agent;
  accounts: EmailIntegrationState["accounts"];
  access?: AgentEmailAccess;
  showAgentIdentity?: boolean;
  onSaved: (access: AgentEmailAccess) => void;
  onRevoked: (state: EmailIntegrationState) => void;
}) {
  const [accountIds, setAccountIds] = useState(access?.accountIds ?? []);
  const [readEnabled, setReadEnabled] = useState(access?.readEnabled ?? true);
  const [draftEnabled, setDraftEnabled] = useState(
    access?.draftEnabled ?? false,
  );
  const [sendEnabled, setSendEnabled] = useState(access?.sendEnabled ?? false);
  const [sendPolicy, setSendPolicy] = useState<EmailSendPolicy>(
    access?.sendPolicy ?? "disabled",
  );
  const [saving, setSaving] = useState(false);
  const summary = accountIds.length
    ? `${accountIds.length} account${accountIds.length === 1 ? "" : "s"}`
    : "Not configured";
  const selectedAccounts = useMemo(
    () => accounts.filter(({ id }) => accountIds.includes(id)),
    [accountIds, accounts],
  );
  const supportsRead = selectedAccounts.some(
    ({ capabilities }) => capabilities.read,
  );
  const supportsDraft = selectedAccounts.some(
    ({ capabilities }) => capabilities.draft,
  );
  const supportsSend = selectedAccounts.some(
    ({ capabilities }) => capabilities.send,
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
            readEnabled: supportsRead && readEnabled,
            draftEnabled: supportsDraft && draftEnabled,
            sendEnabled: supportsSend && sendEnabled,
            sendPolicy: supportsSend && sendEnabled ? sendPolicy : "disabled",
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
    <div className={showAgentIdentity ? "p-4" : "py-1"}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {showAgentIdentity ? agent.name : "Scoped Email profile"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {showAgentIdentity ? `${agent.role} · ` : ""}
            {summary}
          </p>
        </div>
        {access ? (
          <Badge variant="outline">Token {access.tokenPrefix}…</Badge>
        ) : null}
        {access ? (
          <Button variant="ghost" size="sm" onClick={revoke} disabled={saving}>
            <Trash2 /> Revoke
          </Button>
        ) : null}
        <Button
          size="sm"
          onClick={save}
          disabled={saving || accountIds.length === 0}
        >
          {saving ? <LoaderCircle className="animate-spin" /> : <Check />}
          Save profile
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
            <span className="min-w-0">
              <span className="block truncate">{account.displayName}</span>
              <span className="block truncate font-mono text-[11px] font-normal text-muted-foreground">
                {account.emailAddress}
              </span>
            </span>
          </label>
        ))}
      </div>

      {selectedAccounts.length > 0 ? (
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          Actual sender{selectedAccounts.length === 1 ? "" : "s"}:{" "}
          <span className="font-mono text-foreground">
            {selectedAccounts
              .map(
                ({ displayName, emailAddress }) =>
                  `${displayName} <${emailAddress}>`,
              )
              .join(", ")}
          </span>
          . Agent instructions and message signatures do not change the SMTP
          sender.
        </p>
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PermissionToggle
          label="Read"
          checked={supportsRead && readEnabled}
          onCheckedChange={setReadEnabled}
          disabled={!supportsRead}
        />
        <PermissionToggle
          label="Draft"
          checked={supportsDraft && draftEnabled}
          onCheckedChange={setDraftEnabled}
          disabled={!supportsDraft}
        />
        <PermissionToggle
          label="Send"
          checked={supportsSend && sendEnabled}
          onCheckedChange={(checked) => {
            setSendEnabled(checked);
            if (!checked) setSendPolicy("disabled");
            else if (sendPolicy === "disabled") {
              setSendPolicy("approval_required");
            }
          }}
          disabled={!supportsSend}
        />
        <label className="grid gap-1.5 rounded-lg bg-muted/50 p-3 text-xs font-semibold">
          <span className="flex items-center gap-1.5">
            <Send className="size-3.5" /> Send policy
          </span>
          <Select
            value={supportsSend ? sendPolicy : "disabled"}
            onValueChange={(value) => {
              const policy = value as EmailSendPolicy;
              setSendPolicy(policy);
              setSendEnabled(policy !== "disabled");
            }}
            disabled={!supportsSend}
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

function PermissionToggle({
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between rounded-lg bg-muted/50 p-3 text-sm font-semibold">
      {label}
      <Switch
        size="sm"
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </label>
  );
}
