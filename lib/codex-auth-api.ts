import { apiError } from "@/lib/api";
import { OperationalError } from "@/lib/operational-error";
import { RunnerRequestError } from "@/lib/runner-errors";

export function codexAuthApiError(error: unknown, fallback: string) {
  if (error instanceof RunnerRequestError) {
    const status =
      error.status >= 400 && error.status <= 599 ? error.status : 502;
    return apiError(
      new OperationalError(fallback, "CODEX_AUTH_REQUEST_FAILED", status),
    );
  }
  return apiError(error, fallback);
}
