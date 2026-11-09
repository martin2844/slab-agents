"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Info, LoaderCircle, MessageCircle, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/client-api";
import type { Agent, Integration, WhatsAppWriteMode } from "@/lib/types";

type Connection = {
  status: string;
  account: string | null;
  qr: string | null;
  integration: Integration | null;
  error: string | null;
  host: {
    available: boolean;
    installation: { state: string; error: string | null } | null;
  };
};
const labels: Record<string, string> = {
  WORKING: "Connected",
  SCAN_QR_CODE: "Scan the QR code",
  STARTING: "Connecting…",
  NOT_LINKED: "Ready to connect",
  STOPPED: "Disconnected",
  FAILED: "Connection failed",
  UNAVAILABLE: "Service unavailable",
  PASSKEY_REQUIRED: "WhatsApp requires a passkey",
  PASSKEY_CONFIRMATION_REQUIRED: "Confirm the passkey in WhatsApp",
};

export function WhatsAppIntegrationEditor({
  agents,
  onSaved,
  onOpenChange,
}: {
  agents: Agent[];
  onSaved: (integration: Integration) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [data, setData] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const mutation = useRef(false);
  const generation = useRef(0);
  const publish = useEffectEvent((next: Connection) => {
    setData(next);
    if (next.integration) onSaved(next.integration);
  });
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const version = generation.current;
      try {
        if (!mutation.current) {
          const next = await api<Connection>("/api/integrations/whatsapp", {
            signal: controller.signal,
          });
          if (!disposed && version === generation.current) publish(next);
        }
      } catch (reason) {
        if (!disposed)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load WhatsApp.",
          );
      } finally {
        if (!disposed) timer = setTimeout(poll, 4000);
      }
    }
    void poll();
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  async function action(action: "install" | "connect" | "restart" | "unlink") {
    if (mutation.current) return;
    mutation.current = true;
    generation.current += 1;
    setBusy(true);
    setError(null);
    try {
      await api("/api/integrations/whatsapp", {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      const next = await api<Connection>("/api/integrations/whatsapp");
      setData(next);
      if (next.integration) onSaved(next.integration);
      setConfirmUnlink(false);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "WhatsApp action failed.",
      );
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  async function access(
    agentId: string,
    read: boolean,
    write: WhatsAppWriteMode,
  ) {
    if (mutation.current || !data?.integration) return;
    mutation.current = true;
    generation.current += 1;
    setBusy(true);
    setError(null);
    try {
      const integration = await api<Integration>("/api/integrations/whatsapp", {
        method: "PATCH",
        body: JSON.stringify({
          agentId,
          read,
          write,
          expectedVersion: data.integration.version,
        }),
      });
      setData((current) => (current ? { ...current, integration } : current));
      onSaved(integration);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not save access.",
      );
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  const installing = ["submitted", "running"].includes(
    data?.host.installation?.state ?? "",
  );
  const connected = data?.status === "WORKING" && data.integration?.enabled;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="size-5" />
            WhatsApp
          </DialogTitle>
          <DialogDescription>
            Connect your WhatsApp and choose which agents can read or send
            messages. To reply when new messages arrive, create an automation.
          </DialogDescription>
        </DialogHeader>
        <section
          aria-label="About WAHA"
          className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4"
        >
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-2 text-sm">
            <h3 className="font-semibold">Unofficial WhatsApp connection</h3>
            <p>
              WAHA is an unofficial connector, not endorsed by WhatsApp or Meta.
              Using it may result in your account being restricted or banned.
              The connection can also stop working if WhatsApp changes.
            </p>
            <p className="text-muted-foreground">
              Messages an agent reads may be sent to its AI provider. Choose
              carefully which agents you give access to.
            </p>
            <a
              href="https://waha.devlike.pro/docs/overview/introduction/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block underline underline-offset-4"
            >
              Read WAHA’s disclaimer
            </a>
          </div>
        </section>
        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {!data ? (
          <p role="status" className="flex items-center gap-2 py-8 text-sm">
            <LoaderCircle className="size-4 animate-spin" />
            Loading connection…
          </p>
        ) : (
          <>
            <section
              className="rounded-lg border p-4"
              aria-label="WhatsApp connection"
            >
              <p className="text-sm font-medium" role="status">
                {installing
                  ? "Setting up WhatsApp…"
                  : (labels[data.status] ?? data.status)}
              </p>
              {data.account && (
                <p className="mt-1 font-mono text-sm">{data.account}</p>
              )}
              {data.status === "FAILED" && (
                <p className="mt-2 text-sm text-muted-foreground">
                  The QR may have expired or the connection was interrupted.
                  Connect again to retry and get a new QR if needed.
                </p>
              )}
              {data.host.installation?.state === "failed" && (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  {data.host.installation.error}
                </p>
              )}
              {data.status === "UNAVAILABLE" ? (
                <div className="mt-3 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {data.host.available
                      ? "Set up WhatsApp on your server, then scan a QR code to connect your account."
                      : "Your server needs an update before you can set up WhatsApp here."}
                  </p>
                  <Button
                    disabled={busy || installing || !data.host.available}
                    onClick={() => void action("install")}
                  >
                    {installing && (
                      <LoaderCircle className="size-4 animate-spin" />
                    )}
                    Install WhatsApp
                  </Button>
                </div>
              ) : (
                <>
                  {data.qr && (
                    <div className="mt-4 grid gap-4 sm:grid-cols-[224px_1fr] sm:items-center">
                      <Image
                        unoptimized
                        src={data.qr}
                        width={224}
                        height={224}
                        alt="Scan this QR code with WhatsApp to link your account"
                        className="rounded-md bg-white p-3"
                      />
                      <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                        <li>Open WhatsApp on your phone.</li>
                        <li>Open Settings → Linked devices → Link a device.</li>
                        <li>
                          Scan this code and keep your phone connected while it
                          finishes.
                        </li>
                      </ol>
                    </div>
                  )}
                  {data.status.startsWith("PASSKEY") && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      Open WhatsApp on your phone and confirm the passkey
                      request to finish connecting.
                    </p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {!connected && !data.qr && (
                      <Button
                        disabled={busy || installing}
                        onClick={() => void action("connect")}
                      >
                        Connect WhatsApp
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      disabled={busy || installing}
                      onClick={() => void action("restart")}
                    >
                      <RefreshCw className="size-4" />
                      {data.qr ? "Refresh QR" : "Reconnect"}
                    </Button>
                  </div>
                </>
              )}
              {data.integration?.enabled && (
                <Button
                  className="mt-3"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setConfirmUnlink(true)}
                >
                  Unlink account
                </Button>
              )}
              {confirmUnlink && (
                <div className="mt-4 border-t pt-3">
                  <p className="text-sm">
                    Unlink this account and remove all agent access?
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() => void action("unlink")}
                    >
                      Unlink account
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => setConfirmUnlink(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </section>
            {data.integration && (
              <section aria-label="WhatsApp agent permissions">
                <Button variant="outline" asChild className="mb-4">
                  <Link
                    href="/automations/new?template=whatsapp-replies"
                    onClick={() => onOpenChange(false)}
                  >
                    Set up replies
                  </Link>
                </Button>
                <h3 className="text-sm font-semibold">Agent permissions</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Reading allows an agent to open chats and messages. Choose
                  whether it can send messages, and whether you want to approve
                  each one. Automations can have their own approval rules.
                  Removing send permission stops all replies. These permissions
                  alone do not turn on automatic replies.
                </p>
                <div className="mt-3 divide-y rounded-lg border">
                  {agents.map((agent) => {
                    const grants =
                      data.integration!.permissions[agent.id] ?? [];
                    const read = grants.includes("whatsapp_list_chats");
                    const write = grants.includes("whatsapp_send_text")
                      ? (data.integration!.whatsappWriteModes?.[agent.id] ??
                        "approval_required")
                      : "disabled";
                    return (
                      <div
                        key={agent.id}
                        className="flex flex-wrap items-center gap-4 p-3"
                      >
                        <span className="min-w-24 flex-1 text-sm font-medium">
                          {agent.name}
                        </span>
                        <label className="flex items-center gap-2 text-sm">
                          <Switch
                            aria-label={`Read WhatsApp for ${agent.name}`}
                            checked={read}
                            disabled={busy || (!connected && !read)}
                            onCheckedChange={(value) =>
                              void access(agent.id, value, write)
                            }
                          />
                          Read messages
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          Send messages
                          <select
                            aria-label={`Send WhatsApp for ${agent.name}`}
                            className="h-9 rounded-md border bg-background px-2 text-sm"
                            value={write}
                            disabled={
                              busy || (!connected && write === "disabled")
                            }
                            onChange={(event) =>
                              void access(
                                agent.id,
                                read,
                                event.target.value as WhatsAppWriteMode,
                              )
                            }
                          >
                            <option value="disabled">Not allowed</option>
                            <option
                              value="approval_required"
                              disabled={!connected && write === "disabled"}
                            >
                              Ask me first
                            </option>
                            <option
                              value="autonomous"
                              disabled={!connected && write !== "autonomous"}
                            >
                              Without asking
                            </option>
                          </select>
                        </label>
                      </div>
                    );
                  })}
                  {!agents.length && (
                    <p className="p-3 text-sm text-muted-foreground">
                      Create an agent to assign access.
                    </p>
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
