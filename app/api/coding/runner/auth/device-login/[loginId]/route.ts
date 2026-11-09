import { codexAuthApiError } from "@/lib/codex-auth-api";
import { cancelCodexDeviceLogin } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ loginId: string }> }) {
  try {
    const { loginId } = await context.params;
    return Response.json({ data: await cancelCodexDeviceLogin(loginId, fetch, "code") });
  } catch (error) {
    return codexAuthApiError(error, "Could not cancel Codex authentication on the code runner");
  }
}
