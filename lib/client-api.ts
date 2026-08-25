export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly details: Record<string, unknown> | null;

  constructor(input: {
    message: string;
    status: number;
    code?: string | null;
    details?: Record<string, unknown> | null;
  }) {
    super(input.message);
    this.name = "ApiClientError";
    this.status = input.status;
    this.code = input.code ?? null;
    this.details = input.details ?? null;
  }
}

export async function apiClientError(response: Response) {
  const payload = await response.json().catch(() => ({}));
  const structuredError =
    payload.error && typeof payload.error === "object"
      ? (payload.error as Record<string, unknown>)
      : null;
  return new ApiClientError({
    message:
      typeof payload.error === "string"
        ? payload.error
        : typeof structuredError?.message === "string"
          ? structuredError.message
          : `Request failed (${response.status})`,
    status: response.status,
    code:
      typeof structuredError?.code === "string"
        ? structuredError.code
        : typeof payload.code === "string"
          ? payload.code
          : null,
    details:
      structuredError?.details && typeof structuredError.details === "object"
        ? (structuredError.details as Record<string, unknown>)
        : payload.details && typeof payload.details === "object"
          ? payload.details
          : null,
  });
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    throw await apiClientError(response);
  }
  const payload = await response.json().catch(() => ({}));
  return payload.data as T;
}
