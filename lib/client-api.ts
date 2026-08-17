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

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiClientError({
      message:
        typeof payload.error === "string"
          ? payload.error
          : `Request failed (${response.status})`,
      status: response.status,
      code: typeof payload.code === "string" ? payload.code : null,
      details:
        payload.details && typeof payload.details === "object"
          ? payload.details
          : null,
    });
  }
  return payload.data as T;
}
