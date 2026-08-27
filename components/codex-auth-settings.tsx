"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Clipboard,
  ExternalLink,
  LoaderCircle,
  LogOut,
  RefreshCw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client-api";
import type {
  CodexAuthStatus,
  CodexDeviceLogin,
} from "@/lib/codex-auth-contract";
import { formatDateTime } from "@/lib/utils";

const emptyUnavailableStatus: CodexAuthStatus = {
  status: "unavailable",
  authMode: null,
  email: null,
  planType: null,
  login: null,
};

function loginStatusLabel(login: CodexDeviceLogin) {
  switch (login.status) {
    case "succeeded":
      return "Authentication completed";
    case "failed":
      return "Authentication failed";
    case "cancelled":
      return "Authentication cancelled";
    case "expired":
      return "Authentication expired";
    default:
      return "Waiting for authentication";
  }
}

export function CodexAuthSettings({
  registered,
  onAuthenticationChanged,
}: {
  registered: boolean;
  onAuthenticationChanged: () => Promise<void>;
}) {
  const [auth, setAuth] = useState<CodexAuthStatus | null>(null);
  const [busy, setBusy] = useState<"start" | "cancel" | "logout" | null>(null);
  const previousStatus = useRef<CodexAuthStatus["status"] | null>(null);
  const requestGeneration = useRef(0);
  const statusControllers = useRef(new Set<AbortController>());
  const mutationActive = useRef(false);

  const invalidateStatusReads = useCallback(() => {
    requestGeneration.current += 1;
    for (const controller of statusControllers.current) controller.abort();
    statusControllers.current.clear();
  }, []);

  const refresh = useCallback(
    async (quiet = false) => {
      invalidateStatusReads();
      const requestId = requestGeneration.current;
      const controller = new AbortController();
      statusControllers.current.add(controller);
      try {
        const next = await api<CodexAuthStatus>("/api/runtimes/codex/auth", {
          signal: controller.signal,
        });
        if (requestId !== requestGeneration.current) return null;
        setAuth(next);
        const initialRead = previousStatus.current === null;
        const becameAuthenticated =
          next.status === "authenticated" &&
          previousStatus.current !== "authenticated";
        previousStatus.current = next.status;
        if (becameAuthenticated) {
          if (!initialRead) toast.success("Codex connected");
          void onAuthenticationChanged().catch(() =>
            toast.error("Codex connected, but runtime health did not refresh."),
          );
        }
        return next;
      } catch (error) {
        if (!quiet && !controller.signal.aborted) {
          setAuth(emptyUnavailableStatus);
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not read Codex authentication status",
          );
        }
        return null;
      } finally {
        statusControllers.current.delete(controller);
      }
    },
    [invalidateStatusReads, onAuthenticationChanged],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0);
    return () => {
      window.clearTimeout(timeout);
      invalidateStatusReads();
    };
  }, [invalidateStatusReads, refresh]);

  useEffect(() => {
    if (auth?.login?.status !== "pending" || busy !== null) return;
    let stopped = false;
    let timeout = 0;
    const poll = async () => {
      const next = await refresh(true);
      if (
        !stopped &&
        !mutationActive.current &&
        (next === null || next.login?.status === "pending")
      ) {
        timeout = window.setTimeout(
          () => void poll(),
          next === null ? 4_000 : 2_000,
        );
      }
    };
    timeout = window.setTimeout(() => void poll(), 2_000);
    return () => {
      stopped = true;
      window.clearTimeout(timeout);
    };
  }, [auth?.login?.status, busy, refresh]);

  async function startLogin() {
    mutationActive.current = true;
    invalidateStatusReads();
    setBusy("start");
    try {
      const login = await api<CodexDeviceLogin>(
        "/api/runtimes/codex/auth/device-login",
        { method: "POST" },
      );
      setAuth((current) => ({
        ...(current ?? emptyUnavailableStatus),
        status: "not_authenticated",
        authMode: null,
        email: null,
        planType: null,
        login,
      }));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not start Codex authentication",
      );
    } finally {
      mutationActive.current = false;
      setBusy(null);
    }
  }

  async function cancelLogin(loginId: string) {
    mutationActive.current = true;
    invalidateStatusReads();
    setBusy("cancel");
    try {
      const login = await api<CodexDeviceLogin>(
        `/api/runtimes/codex/auth/device-login/${encodeURIComponent(loginId)}`,
        { method: "DELETE" },
      );
      setAuth((current) =>
        current ? { ...current, login } : emptyUnavailableStatus,
      );
      toast.success("Codex authentication cancelled");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not cancel Codex authentication",
      );
    } finally {
      mutationActive.current = false;
      setBusy(null);
    }
  }

  async function logout() {
    mutationActive.current = true;
    invalidateStatusReads();
    setBusy("logout");
    try {
      const next = await api<CodexAuthStatus>(
        "/api/runtimes/codex/auth/logout",
        { method: "POST" },
      );
      previousStatus.current = next.status;
      setAuth(next);
      toast.success("Signed out of Codex");
      void onAuthenticationChanged().catch(() =>
        toast.error("Signed out, but runtime health did not refresh."),
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not sign out of Codex",
      );
    } finally {
      mutationActive.current = false;
      setBusy(null);
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Authentication code copied");
    } catch {
      toast.error("Could not copy the code. Select it and copy it manually.");
    }
  }

  if (!auth) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        Checking Codex authentication…
      </div>
    );
  }

  if (auth.status === "authenticated") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
        <div className="flex min-w-0 items-start gap-2">
          <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          <div className="min-w-0">
            <p className="text-xs font-semibold">Codex account connected</p>
            <p className="truncate text-xs text-muted-foreground">
              {auth.email ?? "Authenticated account"}
              {auth.planType ? ` · ${auth.planType}` : ""}
              {auth.authMode ? ` · ${auth.authMode.replaceAll("_", " ")}` : ""}
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void logout()}
          disabled={busy !== null}
        >
          {busy === "logout" ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <LogOut />
          )}
          Sign out
        </Button>
      </div>
    );
  }

  const pendingLogin = auth.login?.status === "pending" ? auth.login : null;

  return (
    <div className="grid gap-3 rounded-md border bg-muted/30 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold">ChatGPT authentication</p>
            {pendingLogin ? <Badge variant="secondary">Pending</Badge> : null}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {auth.status === "unavailable"
              ? "The Runner could not read Codex authentication."
              : pendingLogin
                ? "Open OpenAI, enter the code, and return here."
                : "Connect a ChatGPT account without opening a server shell."}
          </p>
        </div>
        {auth.status === "unavailable" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void refresh()}
            disabled={!registered || busy !== null}
          >
            <RefreshCw />
            Retry
          </Button>
        ) : null}
      </div>

      {pendingLogin ? (
        <div className="flex flex-wrap items-center gap-2">
          <code className="select-all rounded border bg-background px-3 py-2 font-mono text-sm font-semibold tracking-wider">
            {pendingLogin.userCode}
          </code>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void copyCode(pendingLogin.userCode)}
          >
            <Clipboard />
            Copy code
          </Button>
          <Button type="button" size="sm" asChild>
            <a
              href={pendingLogin.verificationUrl}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink />
              Open OpenAI
            </a>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void cancelLogin(pendingLogin.loginId)}
            disabled={busy !== null}
          >
            {busy === "cancel" ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <X />
            )}
            Cancel
          </Button>
          <span className="text-xs text-muted-foreground">
            Expires {formatDateTime(pendingLogin.expiresAt)}
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void startLogin()}
            disabled={!registered || busy !== null}
          >
            {busy === "start" ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <ExternalLink />
            )}
            Connect ChatGPT
          </Button>
          {auth.login ? (
            <span className="text-xs text-muted-foreground">
              {loginStatusLabel(auth.login)}. Start a new connection to retry.
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
