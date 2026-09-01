import type { IntegrationProvider } from "@/lib/types";

export type GoogleDataProvider =
  | "google_analytics"
  | "google_search_console";

export const GOOGLE_ANALYTICS_TOOL_KEYS = [
  "google_analytics_list_properties",
  "google_analytics_search_metadata",
  "google_analytics_run_report",
  "google_analytics_run_realtime_report",
] as const;

export const GOOGLE_SEARCH_CONSOLE_TOOL_KEYS = [
  "search_console_list_sites",
  "search_console_query_performance",
  "search_console_list_sitemaps",
  "search_console_inspect_url",
] as const;

export const GOOGLE_DATA_TOOL_KEYS = {
  google_analytics: GOOGLE_ANALYTICS_TOOL_KEYS,
  google_search_console: GOOGLE_SEARCH_CONSOLE_TOOL_KEYS,
} satisfies Record<GoogleDataProvider, readonly string[]>;

export const GOOGLE_DATA_SCOPES = {
  google_analytics: [
    "openid",
    "email",
    "https://www.googleapis.com/auth/analytics.readonly",
  ],
  google_search_console: [
    "openid",
    "email",
    "https://www.googleapis.com/auth/webmasters.readonly",
  ],
} satisfies Record<GoogleDataProvider, readonly string[]>;

export type GoogleDataCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  accessToken?: string;
  accessTokenExpiresAt?: string;
};

export type GoogleDataConnectionInput = {
  id?: string;
  expectedVersion?: number;
  provider: GoogleDataProvider;
  name: string;
  clientId?: string;
  clientSecret?: string;
  reuseGmailOAuthCredentials?: boolean;
  enabled?: boolean;
  permissions?: Record<string, string[]>;
};

export function isGoogleDataProvider(
  provider: IntegrationProvider | string,
): provider is GoogleDataProvider {
  return (
    provider === "google_analytics" ||
    provider === "google_search_console"
  );
}

export function clearGoogleDataGrant(
  credentials: GoogleDataCredentials,
): GoogleDataCredentials {
  return {
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
  };
}
