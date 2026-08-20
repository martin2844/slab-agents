import "server-only";

import { readSecret } from "@/lib/server-config";
import type { EmailAccount, GmailOAuthSettings } from "@/lib/types";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  admin?: boolean;
};

type RemoteEmailAccount = Omit<EmailAccount, "connection"> & {
  config?: {
    imapHost?: string;
    imapPort?: number;
    imapTlsMode?: "ssl" | "starttls" | "none";
    smtpHost?: string;
    smtpPort?: number;
    smtpTlsMode?: "ssl" | "starttls" | "none";
  };
};

export type RemoteAccessProfile = {
  id: string;
  name: string;
  readEnabled: boolean;
  draftEnabled: boolean;
  sendEnabled: boolean;
  accountIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type RemoteConnectorToken = {
  token: string;
  id: string;
  prefix: string;
};

function adminKey() {
  const value = readSecret("SLAB_EMAIL_ADMIN_KEY", "SLAB_EMAIL_ADMIN_KEY_FILE");
  if (!value) {
    throw new Error(
      "SLAB_EMAIL_ADMIN_KEY is not configured in the slab-agents server environment.",
    );
  }
  return value;
}

export function normalizeEmailServiceUrl(value: string) {
  const parsed = new URL(value.trim());
  if (!(["http:", "https:"] as string[]).includes(parsed.protocol)) {
    throw new Error("Email service URL must use HTTP or HTTPS.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(
      "Email service URL cannot contain credentials or query data.",
    );
  }
  return parsed.toString().replace(/\/$/, "");
}

function safeAccount(account: RemoteEmailAccount): EmailAccount {
  return {
    id: account.id,
    provider: account.provider,
    emailAddress: account.emailAddress,
    displayName: account.displayName,
    enabled: account.enabled,
    capabilities: account.capabilities,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    lastConnectionStatus: account.lastConnectionStatus ?? null,
    lastConnectionAt: account.lastConnectionAt ?? null,
    connection: {
      imapHost: account.config?.imapHost ?? "",
      imapPort: account.config?.imapPort ?? 0,
      imapTlsMode: account.config?.imapTlsMode ?? "starttls",
      smtpHost: account.config?.smtpHost ?? "",
      smtpPort: account.config?.smtpPort ?? 0,
      smtpTlsMode: account.config?.smtpTlsMode ?? "starttls",
    },
  };
}

export class EmailAdminClient {
  constructor(private readonly serviceUrl: string) {}

  private async request<T>(path: string, options: RequestOptions = {}) {
    const response = await fetch(`${this.serviceUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(options.admin === false
          ? {}
          : { Authorization: `Bearer ${adminKey()}` }),
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string; code?: string };
      } | null;
      const message =
        payload?.error?.message ||
        `Email service returned ${response.status} ${response.statusText}.`;
      throw new Error(
        payload?.error?.code ? `${payload.error.code}: ${message}` : message,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  health() {
    return this.request<{ status: string }>("/health", { admin: false });
  }

  async listAccounts() {
    const accounts = await this.request<RemoteEmailAccount[]>("/api/accounts");
    return accounts.map(safeAccount);
  }

  async getAccount(accountId: string) {
    return safeAccount(
      await this.request<RemoteEmailAccount>(
        `/api/accounts/${encodeURIComponent(accountId)}`,
      ),
    );
  }

  async createAccount(
    provider: "proton-bridge" | "imap-smtp",
    input: Record<string, unknown>,
  ) {
    return safeAccount(
      await this.request<RemoteEmailAccount>(`/api/accounts/${provider}`, {
        method: "POST",
        body: input,
      }),
    );
  }

  async updateAccount(accountId: string, input: Record<string, unknown>) {
    return safeAccount(
      await this.request<RemoteEmailAccount>(
        `/api/accounts/${encodeURIComponent(accountId)}`,
        { method: "PATCH", body: input },
      ),
    );
  }

  testAccount(accountId: string) {
    return this.request<{
      status: "ok" | "error";
      latencyMs: number;
      message?: string;
      connectionStatus?: string | null;
      providerMessage?: string;
    }>(`/api/accounts/${encodeURIComponent(accountId)}/test`, {
      method: "POST",
    });
  }

  setAccountEnabled(accountId: string, enabled: boolean) {
    return this.request<RemoteEmailAccount>(
      `/api/accounts/${encodeURIComponent(accountId)}/${enabled ? "enable" : "disable"}`,
      { method: "POST" },
    ).then(safeAccount);
  }

  deleteAccount(accountId: string) {
    return this.request<void>(
      `/api/accounts/${encodeURIComponent(accountId)}`,
      {
        method: "DELETE",
      },
    );
  }

  connectGmail(returnUrl: string) {
    return this.request<{
      authorizationUrl: string;
      state: string;
      expiresAt: string;
    }>("/api/accounts/gmail/connect", {
      method: "POST",
      body: { returnUrl },
    });
  }

  completeGmail(code: string, state: string) {
    const query = new URLSearchParams({ code, state });
    return this.request<{ accountId: string; emailAddress: string }>(
      `/api/oauth/google/callback?${query.toString()}`,
      { admin: false },
    );
  }

  getGoogleOAuthSettings() {
    return this.request<GmailOAuthSettings>("/api/settings/google-oauth");
  }

  saveGoogleOAuthSettings(input: {
    clientId: string;
    clientSecret?: string;
  }) {
    return this.request<GmailOAuthSettings>("/api/settings/google-oauth", {
      method: "PATCH",
      body: input,
    });
  }

  createProfile(
    input: Omit<RemoteAccessProfile, "id" | "createdAt" | "updatedAt">,
  ) {
    return this.request<RemoteAccessProfile>("/api/access-profiles", {
      method: "POST",
      body: input,
    });
  }

  updateProfile(
    profileId: string,
    input: Omit<RemoteAccessProfile, "id" | "createdAt" | "updatedAt">,
  ) {
    return this.request<RemoteAccessProfile>(
      `/api/access-profiles/${encodeURIComponent(profileId)}`,
      { method: "PATCH", body: input },
    );
  }

  createToken(profileId: string) {
    return this.request<RemoteConnectorToken>(
      `/api/access-profiles/${encodeURIComponent(profileId)}/tokens`,
      { method: "POST" },
    );
  }

  listTokens(profileId: string) {
    return this.request<
      Array<{
        id: string;
        tokenPrefix: string;
        createdAt: string;
        lastUsedAt: string | null;
        revokedAt: string | null;
      }>
    >(`/api/access-profiles/${encodeURIComponent(profileId)}/tokens`);
  }

  revokeToken(profileId: string, tokenId: string) {
    return this.request<void>(
      `/api/access-profiles/${encodeURIComponent(profileId)}/tokens/${encodeURIComponent(tokenId)}`,
      { method: "DELETE" },
    );
  }
}
