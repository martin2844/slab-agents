import type {
  GoogleDataCredentials,
  GoogleDataProvider,
} from "@/lib/integrations/google-data-contract";

const REQUEST_TIMEOUT_MS = 15_000;
const RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;

export class GoogleDataError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(
    code: string,
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = "GoogleDataError";
    this.code = code;
    this.status = status;
  }
}

function safeMessage(value: unknown, secrets: string[]) {
  let message =
    typeof value === "string" && value.trim()
      ? value.trim()
      : "Google returned an unexpected response.";
  for (const secret of secrets.filter(Boolean)) {
    message = message.replaceAll(secret, "[REDACTED]");
  }
  return message.slice(0, 500);
}

async function readJson(response: Response, secrets: string[]) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > RESPONSE_LIMIT_BYTES) {
    throw new GoogleDataError(
      "GOOGLE_RESPONSE_TOO_LARGE",
      "Google returned too much data. Use a narrower query or smaller row limit.",
      response.status,
    );
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > RESPONSE_LIMIT_BYTES) {
      await reader.cancel();
      throw new GoogleDataError(
        "GOOGLE_RESPONSE_TOO_LARGE",
        "Google returned too much data. Use a narrower query or smaller row limit.",
        response.status,
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GoogleDataError(
      "GOOGLE_INVALID_RESPONSE",
      safeMessage("Google returned invalid JSON.", secrets),
      response.status,
    );
  }
}

function errorFromBody(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : null;
  }
  return null;
}

async function googleRequest<T>(input: {
  url: string;
  accessToken: string;
  method?: "GET" | "POST";
  body?: unknown;
  secrets: string[];
}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input.url, {
      method: input.method ?? "GET",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: "application/json",
        ...(input.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new GoogleDataError(
        "GOOGLE_TIMEOUT",
        "Google did not respond within 15 seconds.",
      );
    }
    throw new GoogleDataError(
      "GOOGLE_CONNECTION_FAILED",
      "Could not reach the Google API.",
    );
  }
  const body = await readJson(response, input.secrets);
  if (!response.ok) {
    const auth = response.status === 401 || response.status === 403;
    throw new GoogleDataError(
      auth ? "GOOGLE_AUTH_FAILED" : "GOOGLE_REQUEST_FAILED",
      safeMessage(
        errorFromBody(body) ?? `Google returned HTTP ${response.status}.`,
        input.secrets,
      ),
      response.status,
    );
  }
  return body as T;
}

function propertyName(value: string) {
  const id = value.trim().replace(/^properties\//, "");
  if (!/^\d{1,30}$/.test(id)) {
    throw new GoogleDataError(
      "GOOGLE_INVALID_INPUT",
      "GA4 propertyId must be the numeric property ID returned by google_analytics_list_properties.",
    );
  }
  return `properties/${id}`;
}

function siteName(value: string) {
  const site = value.trim();
  if (!site || site.length > 2048) {
    throw new GoogleDataError(
      "GOOGLE_INVALID_INPUT",
      "siteUrl must be a Search Console property returned by search_console_list_sites.",
    );
  }
  if (site.startsWith("sc-domain:")) return site;
  const parsed = new URL(site);
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new GoogleDataError(
      "GOOGLE_INVALID_INPUT",
      "Search Console URL-prefix properties must use HTTP or HTTPS.",
    );
  }
  return site;
}

function clamp(value: number | undefined, fallback: number, max: number) {
  return Math.max(1, Math.min(max, Math.trunc(value ?? fallback)));
}

export type GoogleDataAdapter = ReturnType<typeof createGoogleDataAdapter>;

export function createGoogleDataAdapter(
  provider: GoogleDataProvider,
  initialCredentials: GoogleDataCredentials,
  updateCredentials: (credentials: GoogleDataCredentials) => void,
) {
  let credentials = initialCredentials;

  async function accessToken(): Promise<string> {
    if (
      credentials.accessToken &&
      credentials.accessTokenExpiresAt &&
      Date.parse(credentials.accessTokenExpiresAt) > Date.now() + 60_000
    ) {
      return credentials.accessToken;
    }
    if (!credentials.refreshToken) {
      throw new GoogleDataError(
        "GOOGLE_AUTH_REQUIRED",
        "Connect the Google account before using this integration.",
      );
    }
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: credentials.refreshToken,
        grant_type: "refresh_token",
      }),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch(() => null);
    if (!response) {
      throw new GoogleDataError(
        "GOOGLE_CONNECTION_FAILED",
        "Could not refresh the Google authorization.",
      );
    }
    const body = (await readJson(response, [
      credentials.clientSecret,
      credentials.refreshToken,
    ])) as { access_token?: string; expires_in?: number } | null;
    if (!response.ok || !body?.access_token) {
      throw new GoogleDataError(
        "GOOGLE_AUTH_FAILED",
        safeMessage(
          errorFromBody(body) ?? "Google authorization must be renewed.",
          [credentials.clientSecret, credentials.refreshToken],
        ),
        response.status,
      );
    }
    const refreshedAccessToken = body.access_token;
    credentials = {
      ...credentials,
      accessToken: refreshedAccessToken,
      accessTokenExpiresAt: new Date(
        Date.now() + Math.max(60, body.expires_in ?? 3600) * 1000,
      ).toISOString(),
    };
    updateCredentials(credentials);
    return refreshedAccessToken;
  }

  async function request<T>(input: {
    url: string;
    method?: "GET" | "POST";
    body?: unknown;
  }) {
    const token = await accessToken();
    return googleRequest<T>({
      ...input,
      accessToken: token,
      secrets: [
        token,
        credentials.clientSecret,
        credentials.refreshToken ?? "",
      ],
    });
  }

  return {
    provider,
    async test() {
      if (provider === "google_analytics") {
        await request({
          url: "https://analyticsadmin.googleapis.com/v1alpha/accountSummaries?pageSize=1",
        });
      } else {
        await request({
          url: "https://www.googleapis.com/webmasters/v3/sites",
        });
      }
      return { connected: true as const };
    },
    async accountIdentity() {
      return request<{ email?: string }>({
        url: "https://openidconnect.googleapis.com/v1/userinfo",
      });
    },
    async listAnalyticsProperties(input: {
      pageSize?: number;
      pageToken?: string;
    }) {
      const query = new URLSearchParams({
        pageSize: String(clamp(input.pageSize, 100, 200)),
        ...(input.pageToken ? { pageToken: input.pageToken } : {}),
      });
      return request({
        url: `https://analyticsadmin.googleapis.com/v1alpha/accountSummaries?${query}`,
      });
    },
    async searchAnalyticsMetadata(input: {
      propertyId: string;
      query?: string;
      kind?: "all" | "dimension" | "metric";
      limit?: number;
    }) {
      const response = await request<{
        dimensions?: Array<Record<string, unknown>>;
        metrics?: Array<Record<string, unknown>>;
      }>({
        url: `https://analyticsdata.googleapis.com/v1beta/${propertyName(input.propertyId)}/metadata`,
      });
      const needle = input.query?.trim().toLowerCase() ?? "";
      const limit = clamp(input.limit, 30, 100);
      const matching = (rows: Array<Record<string, unknown>> | undefined) =>
        (rows ?? [])
          .filter((row) =>
            needle
              ? [row.apiName, row.uiName, row.description]
                  .filter((value): value is string => typeof value === "string")
                  .some((value) => value.toLowerCase().includes(needle))
              : true,
          )
          .slice(0, limit)
          .map(({ apiName, uiName, description, category, type }) => ({
            apiName,
            uiName,
            description,
            category,
            type,
          }));
      return {
        ...(input.kind === "metric"
          ? {}
          : { dimensions: matching(response.dimensions) }),
        ...(input.kind === "dimension"
          ? {}
          : { metrics: matching(response.metrics) }),
      };
    },
    async runAnalyticsReport(input: {
      propertyId: string;
      startDate: string;
      endDate: string;
      dimensions: string[];
      metrics: string[];
      limit?: number;
      offset?: number;
      keepEmptyRows?: boolean;
    }) {
      return request({
        url: `https://analyticsdata.googleapis.com/v1beta/${propertyName(input.propertyId)}:runReport`,
        method: "POST",
        body: {
          dateRanges: [{ startDate: input.startDate, endDate: input.endDate }],
          dimensions: input.dimensions.map((name) => ({ name })),
          metrics: input.metrics.map((name) => ({ name })),
          limit: String(clamp(input.limit, 100, 500)),
          offset: String(Math.max(0, Math.trunc(input.offset ?? 0))),
          keepEmptyRows: input.keepEmptyRows ?? false,
        },
      });
    },
    async runAnalyticsRealtimeReport(input: {
      propertyId: string;
      dimensions: string[];
      metrics: string[];
      limit?: number;
    }) {
      return request({
        url: `https://analyticsdata.googleapis.com/v1beta/${propertyName(input.propertyId)}:runRealtimeReport`,
        method: "POST",
        body: {
          dimensions: input.dimensions.map((name) => ({ name })),
          metrics: input.metrics.map((name) => ({ name })),
          limit: String(clamp(input.limit, 100, 250)),
        },
      });
    },
    async listSearchConsoleSites() {
      return request({
        url: "https://www.googleapis.com/webmasters/v3/sites",
      });
    },
    async querySearchPerformance(input: {
      siteUrl: string;
      startDate: string;
      endDate: string;
      dimensions: string[];
      searchType?: string;
      rowLimit?: number;
      startRow?: number;
    }) {
      if (input.startDate > input.endDate) {
        throw new GoogleDataError(
          "GOOGLE_INVALID_INPUT",
          "startDate must be on or before endDate.",
        );
      }
      const site = encodeURIComponent(siteName(input.siteUrl));
      return request({
        url: `https://www.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`,
        method: "POST",
        body: {
          startDate: input.startDate,
          endDate: input.endDate,
          dimensions: input.dimensions,
          type: input.searchType ?? "web",
          rowLimit: clamp(input.rowLimit, 250, 1000),
          startRow: Math.max(0, Math.trunc(input.startRow ?? 0)),
          dataState: "final",
        },
      });
    },
    async listSearchConsoleSitemaps(input: { siteUrl: string }) {
      const site = encodeURIComponent(siteName(input.siteUrl));
      return request({
        url: `https://www.googleapis.com/webmasters/v3/sites/${site}/sitemaps`,
      });
    },
    async inspectSearchConsoleUrl(input: {
      siteUrl: string;
      inspectionUrl: string;
      languageCode?: string;
    }) {
      const site = siteName(input.siteUrl);
      const inspected = new URL(input.inspectionUrl);
      if (!new Set(["http:", "https:"]).has(inspected.protocol)) {
        throw new GoogleDataError(
          "GOOGLE_INVALID_INPUT",
          "inspectionUrl must use HTTP or HTTPS.",
        );
      }
      return request({
        url: "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
        method: "POST",
        body: {
          siteUrl: site,
          inspectionUrl: inspected.toString(),
          ...(input.languageCode
            ? { languageCode: input.languageCode }
            : {}),
        },
      });
    },
  };
}
