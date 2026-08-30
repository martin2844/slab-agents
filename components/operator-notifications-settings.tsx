"use client";

import { useState } from "react";
import { BellRing, LoaderCircle, MailCheck, Save } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client-api";
import { formatDateTime } from "@/lib/utils";
import type {
  EmailAccount,
  OperatorNotificationState,
} from "@/lib/types";
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
      toast.success(
        updated.enabled
          ? "Operator notifications enabled"
          : "Operator notifications disabled",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not save notifications",
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

  return (
    <section className="max-w-4xl rounded-lg border bg-card p-4 sm:p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="flex gap-3">
          <BellRing className="mt-0.5 size-4" />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Operator notifications</h2>
              <Badge variant={state.enabled ? "secondary" : "outline"}>
                {state.enabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Email the operator when an approval, failure, blocked item,
              unhealthy integration, or system update needs attention.
            </p>
          </div>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label="Enable operator notifications"
        />
      </div>

      <div className="mt-4 grid gap-3 border-y py-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-xs font-semibold">
          Notify
          <Input
            type="email"
            value={recipientEmail}
            onChange={(event) => setRecipientEmail(event.target.value)}
            placeholder="operator@example.com"
          />
        </label>
        <label className="grid gap-1.5 text-xs font-semibold">
          Send from
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
        </label>
      </div>

      {senders.length === 0 ? (
        <p className="mt-3 text-xs text-destructive">
          Connect an Email account with send capability before enabling
          notifications.
        </p>
      ) : null}
      {state.lastError ? (
        <p className="mt-3 text-xs text-destructive">{state.lastError}</p>
      ) : null}

      <div className="mt-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <p className="text-xs text-muted-foreground">
          {state.lastTestedAt
            ? `Last tested ${formatDateTime(state.lastTestedAt)}`
            : "Not tested yet"}
          {state.tokenPrefix ? ` · scoped token ${state.tokenPrefix}…` : ""}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={test}
            disabled={!state.enabled || testing}
          >
            {testing ? <LoaderCircle className="animate-spin" /> : <MailCheck />}
            Send test
          </Button>
          <Button
            onClick={save}
            disabled={saving || !recipientEmail || (enabled && !accountId)}
          >
            {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
            Save
          </Button>
        </div>
      </div>

      {state.recentDeliveries.length > 0 ? (
        <div className="mt-5 border-t pt-4">
          <h3 className="text-xs font-semibold">Recent deliveries</h3>
          <div className="mt-2 divide-y border-y">
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
                  variant={delivery.status === "failed" ? "destructive" : "outline"}
                >
                  {delivery.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
