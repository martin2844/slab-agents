import { ZodError } from "zod";

export function apiError(error: unknown, fallback = "Request failed") {
  if (error instanceof ZodError)
    return Response.json(
      { error: error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  const message = error instanceof Error ? error.message : fallback;
  const status = /not found/i.test(message) ? 404 : 502;
  return Response.json({ error: message }, { status });
}
