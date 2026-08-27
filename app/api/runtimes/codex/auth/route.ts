import { codexAuthApiError } from "@/lib/codex-auth-api";
import { getCodexAuthStatus } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ data: await getCodexAuthStatus() });
  } catch (error) {
    return codexAuthApiError(
      error,
      "Could not read Codex authentication status",
    );
  }
}
