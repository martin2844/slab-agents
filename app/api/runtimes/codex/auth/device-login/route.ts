import { codexAuthApiError } from "@/lib/codex-auth-api";
import { startCodexDeviceLogin } from "@/lib/runner";

export const runtime = "nodejs";

export async function POST() {
  try {
    return Response.json(
      { data: await startCodexDeviceLogin() },
      { status: 202 },
    );
  } catch (error) {
    return codexAuthApiError(error, "Could not start Codex authentication");
  }
}
