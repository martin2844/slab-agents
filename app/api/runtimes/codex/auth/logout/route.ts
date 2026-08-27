import { codexAuthApiError } from "@/lib/codex-auth-api";
import { logoutCodex } from "@/lib/runner";

export const runtime = "nodejs";

export async function POST() {
  try {
    return Response.json({ data: await logoutCodex() });
  } catch (error) {
    return codexAuthApiError(error, "Could not sign out of Codex");
  }
}
