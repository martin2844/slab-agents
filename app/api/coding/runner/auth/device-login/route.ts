import { codexAuthApiError } from "@/lib/codex-auth-api";
import { startCodexDeviceLogin } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return Response.json({ data: await startCodexDeviceLogin(fetch, "code") }, { status: 202 });
  } catch (error) {
    return codexAuthApiError(error, "Could not start Codex authentication on the code runner");
  }
}
