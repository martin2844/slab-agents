"use client";

import { useState } from "react";
import { LoaderCircle, MailCheck, Save } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client-api";
import { formatDateTime } from "@/lib/utils";
import type { EmailAccount, OperatorNotificationState } from "@/lib/types";
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
import { Switch } from "@/components/ui/switch";
import { SettingRow, SettingSection } from "@/components/settings-layout";

export function OperatorNotificationsSettings({
  initialState,
  accounts,
}: {
  initialState: OperatorNotificationState;
  accounts: EmailAccount[];
}) {
  const [state, setState] = useState(initialState);
  const [enabled, setEnabled] = useState(initialState.enabled);
  const [recipientEmail, setRecipientEmail] = useState(
    initialState.recipientEmail,
  );
  const [accountId, setAccountId] = useState(initialState.accountId ?? "");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const senders = accounts.filter(
    (account) => account.enabled && account.capabilities.send,
  );

  async function save() {
    setSaving(true);
    try {
      const updated = await api<OperatorNotificationState>(
        "/api/settings/notifications",
        {
          method: "PATCH",
          body: JSON.stringify({
            enabled,
            recipientEmail,
            accountId: accountId || null,
          }),
        },
      );
      setState(updated);
      setEnabled(updated.enabled);
      setRecipientEmail(updated.recipientEmail);
      setAccountId(updated.accountId ?? "");
      toast.success(
        updated.enabled
          ? "Operator notifications enabled"
          : "Operator notifications disabled",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save notifications",
      );
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      const updated = await api<OperatorNotificationState>(
        "/api/settings/notifications/test",
        { method: "POST" },
      );
      setState(updated);
      toast.success("Test notification sent");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Notification test failed",
      );
    } finally {
      setTesting(false);
    }
  }

  const dirty =
    enabled !== state.enabled ||
    recipientEmail !== state.recipientEmail ||
    accountId !== (state.accountId ?? "");

  return (
    <div className="space-y-7">
      <SettingSection
        title="Operator notifications"
        description="Receive an email when an approval, failure, blocked item, integration, or update needs attention."
      >
        <SettingRow
          title="Email notifications"
          description="Turn operational alerts on or off without removing their configuration."
        >
          <div className="flex items-center justify-between gap-3">
            <Badge variant={enabled ? "secondary" : "outline"}>
              {enabled ? "On" : "Off"}
            </Badge>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label="Enable operator notifications"
            />
          </div>
        </SettingRow>
        <SettingRow
          title="Recipient"
          description="Where operational notifications should be delivered."
        >
          <Input
            type="email"
            value={recipientEmail}
            onChange={(event) => setRecipientEmail(event.target.value)}
            placeholder="operator@example.com"
          />
        </SettingRow>
        <SettingRow
          title="Send from"
          description="Mailbox Slab uses for operator notifications."
        >
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a connected mailbox" />
            </SelectTrigger>
            <SelectContent>
              {senders.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.displayName} · {account.emailAddress}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          title="Delivery test"
          description={`${
            state.lastTestedAt
              ? `Last tested ${formatDateTime(state.lastTestedAt)}`
              : "No test notification has been sent yet."
          }${state.tokenPrefix ? ` · scoped token ${state.tokenPrefix}…` : ""}`}
        >
          <Button
            variant="outline"
            onClick={test}
            disabled={!state.enabled || testing}
          >
            {testing ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <MailCheck />
            )}
            Send test notification
          </Button>
        </SettingRow>
      </SettingSection>

      {senders.length === 0 ? (
        <p className="text-xs text-destructive">
          Connect an Email account with send capability before enabling
          notifications.
        </p>
      ) : null}
      {state.lastError ? (
        <p className="text-xs text-destructive">{state.lastError}</p>
      ) : null}

      {state.recentDeliveries.length > 0 ? (
        <SettingSection title="Recent deliveries">
          <div className="divide-y">
            {state.recentDeliveries.slice(0, 8).map((delivery) => (
              <div
                key={delivery.id}
                className="flex min-h-11 items-center justify-between gap-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{delivery.subject}</p>
                  <p className="text-muted-foreground">
                    {formatDateTime(delivery.createdAt)}
                  </p>
                </div>
                <Badge
                  variant={
                    delivery.status === "failed" ? "destructive" : "outline"
                  }
                >
                  {delivery.status}
                </Badge>
              </div>
            ))}
          </div>
        </SettingSection>
      ) : null}

      {dirty ? (
        <div className="sticky bottom-4 z-20 flex justify-center">
          <div className="flex w-full max-w-xl items-center justify-between gap-3 rounded-lg border bg-primary px-3 py-2 text-primary-foreground shadow-lg">
            <span className="text-sm font-medium">Unsaved changes</span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
                onClick={() => {
                  setEnabled(state.enabled);
                  setRecipientEmail(state.recipientEmail);
                  setAccountId(state.accountId ?? "");
                }}
              >
                Discard
              </Button>
              <Button
                variant="signal"
                onClick={save}
                disabled={saving || !recipientEmail || (enabled && !accountId)}
              >
                {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
                Save changes
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
