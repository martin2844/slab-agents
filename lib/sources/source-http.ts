import "server-only";

import { OperationalError } from "@/lib/operational-error";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export type SourceHttpCredentials = {
  authType: "none" | "basic" | "bearer";
  username?: string | null;
  secret?: string;
};

function authorizationHeaders(
  credentials: SourceHttpCredentials,
): Record<string, string> {
  if (credentials.authType === "bearer" && credentials.secret) {
    return { Authorization: `Bearer ${credentials.secret}` };
  }
  if (credentials.authType === "basic" && credentials.secret) {
    const value = Buffer.from(
      `${credentials.username ?? ""}:${credentials.secret}`,
      "utf8",
    ).toString("base64");
    return { Authorization: `Basic ${value}` };
  }
  return {};
}

function assertHttpUrl(url: URL) {
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new OperationalError(
      "Source URL must use HTTP or HTTPS.",
      "SOURCE_INVALID_URL",
    );
  }
  if (url.username || url.password) {
    throw new OperationalError(
      "Source URL must not contain credentials.",
      "SOURCE_INVALID_URL",
    );
  }
}

async function readLimitedBody(response: Response, maxBytes: number) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new OperationalError(
          `Source response exceeded ${maxBytes} bytes.`,
          "SOURCE_RESPONSE_TOO_LARGE",
          502,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    total,
  );
}

export async function fetchSourceResponse(
  input: URL | string,
  options: {
    credentials: SourceHttpCredentials;
    expectedOrigin?: string;
    timeoutMs?: number;
    maxBytes?: number;
    accept?: string;
  },
) {
  const initial = new URL(input);
  assertHttpUrl(initial);
  const expectedOrigin = options.expectedOrigin ?? initial.origin;
  if (initial.origin !== expectedOrigin) {
    throw new OperationalError(
      "Source request origin does not match its configured origin.",
      "SOURCE_ORIGIN_MISMATCH",
    );
  }

  let current = initial;
  for (
    let redirectCount = 0;
    redirectCount <= MAX_REDIRECTS;
    redirectCount += 1
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    try {
      const response = await fetch(current, {
        method: "GET",
        headers: {
          Accept:
            options.accept ?? "application/json, text/plain;q=0.9, */*;q=0.2",
          "User-Agent": "Slab-Sources/1.0",
          ...authorizationHeaders(options.credentials),
        },
        redirect: "manual",
        signal: controller.signal,
        cache: "no-store",
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new OperationalError(
            "The source returned a redirect without a destination.",
            "SOURCE_INVALID_REDIRECT",
            502,
          );
        }
        const redirected = new URL(location, current);
        assertHttpUrl(redirected);
        if (redirected.origin !== expectedOrigin) {
          await response.body?.cancel();
          throw new OperationalError(
            "The source attempted to redirect to another origin.",
            "SOURCE_REDIRECT_BLOCKED",
            502,
          );
        }
        await response.body?.cancel();
        current = redirected;
        continue;
      }

      const body = await readLimitedBody(
        response,
        options.maxBytes ?? DEFAULT_MAX_BYTES,
      );
      if (!response.ok) {
        const code =
          response.status === 401 || response.status === 403
            ? "SOURCE_AUTH_FAILED"
            : response.status === 404
              ? "SOURCE_HTTP_NOT_FOUND"
              : "SOURCE_HTTP_ERROR";
        throw new OperationalError(
          `Source returned HTTP ${response.status}.`,
          code,
          502,
        );
      }
      return { response, body, url: current };
    } catch (error) {
      if (error instanceof OperationalError) throw error;
      if (controller.signal.aborted) {
        throw new OperationalError(
          "The source did not respond before the timeout.",
          "SOURCE_TIMEOUT",
          504,
        );
      }
      throw new OperationalError(
        error instanceof Error
          ? `The source could not be reached: ${error.message}`
          : "The source could not be reached.",
        "SOURCE_UNAVAILABLE",
        502,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new OperationalError(
    `The source exceeded ${MAX_REDIRECTS} same-origin redirects.`,
    "SOURCE_REDIRECT_LIMIT",
    502,
  );
}

export async function fetchSourceJson<T>(
  input: URL | string,
  options: Parameters<typeof fetchSourceResponse>[1],
) {
  const result = await fetchSourceResponse(input, options);
  try {
    return {
      data: JSON.parse(result.body.toString("utf8")) as T,
      headers: result.response.headers,
      url: result.url,
    };
  } catch {
    throw new OperationalError(
      "Source returned invalid JSON.",
      "SOURCE_INVALID_RESPONSE",
      502,
    );
  }
}

export async function fetchSourceText(
  input: URL | string,
  options: Parameters<typeof fetchSourceResponse>[1],
) {
  const result = await fetchSourceResponse(input, options);
  return {
    text: result.body.toString("utf8"),
    headers: result.response.headers,
    url: result.url,
  };
}
