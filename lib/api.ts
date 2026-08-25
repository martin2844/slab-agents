import { ZodError } from "zod";
import { OperationalError } from "@/lib/operational-error";

export class DomainError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown> | null;

  constructor(
    code: string,
    message: string,
    status: number,
    details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message: string, code = "INVALID_REQUEST") =>
  new DomainError(code, message, 400);
export const notFound = (message: string) =>
  new DomainError("NOT_FOUND", message, 404);
export const conflict = (message: string, code = "CONFLICT") =>
  new DomainError(code, message, 409);

function errorResponse(
  status: number,
  code: string,
  message: string,
  details: Record<string, unknown> | null = null,
) {
  return Response.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status },
  );
}

export function apiError(error: unknown, fallback = "Request failed") {
  if (error instanceof ZodError)
    return errorResponse(
      400,
      "INVALID_REQUEST",
      error.issues[0]?.message ?? "Invalid request",
      { issues: error.issues },
    );
  if (error instanceof DomainError) {
    return errorResponse(
      error.status,
      error.code,
      error.message,
      error.details,
    );
  }
  if (error instanceof OperationalError) {
    return errorResponse(error.status, error.code, error.message);
  }
  const coded = error as {
    code?: unknown;
    details?: Record<string, unknown>;
  };
  const message = error instanceof Error ? error.message : fallback;
  if (coded?.code === "VERSION_CONFLICT") {
    return errorResponse(
      409,
      String(coded.code),
      message,
      coded.details ?? null,
    );
  }
  if (coded?.code === "INTEGRATION_VERSION_CONFLICT") {
    return errorResponse(409, String(coded.code), message);
  }
  if (coded?.code === "INVALID_INTEGRATION_CONFIGURATION") {
    return errorResponse(400, String(coded.code), message);
  }
  if (coded?.code === "INTEGRATION_NOT_FOUND") {
    return errorResponse(404, String(coded.code), message);
  }
  if (coded?.code === "BUDGET_INVALID") {
    return errorResponse(400, String(coded.code), message);
  }
  if (error instanceof Error && error.name === "McpToolError") {
    return errorResponse(
      502,
      typeof coded.code === "string" ? coded.code : "MCP_TOOL_ERROR",
      message,
    );
  }
  console.error("[api] unhandled error", {
    name: error instanceof Error ? error.name : typeof error,
    code: typeof coded?.code === "string" ? coded.code : undefined,
  });
  return errorResponse(500, "INTERNAL_ERROR", fallback);
}
