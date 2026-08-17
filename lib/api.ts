import { ZodError } from "zod";

export function apiError(error: unknown, fallback = "Request failed") {
  if (error instanceof ZodError)
    return Response.json(
      { error: error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  const coded = error as {
    code?: unknown;
    details?: Record<string, unknown>;
  };
  const message = error instanceof Error ? error.message : fallback;
  if (coded?.code === "VERSION_CONFLICT") {
    return Response.json(
      { error: message, code: coded.code, details: coded.details ?? null },
      { status: 409 },
    );
  }
  const status = /not found/i.test(message) ? 404 : 502;
  return Response.json({ error: message }, { status });
}
