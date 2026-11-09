import { codexAuthApiError } from "@/lib/codex-auth-api";
import { logoutCodex } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return Response.json({ data: await logoutCodex(fetch, "code") });
  } catch (error) {
    return codexAuthApiError(error, "Could not sign out Codex on the code runner");
  }
}
