import { z } from "zod";
import { codexAuthApiError } from "@/lib/codex-auth-api";
import { codexLoginIdPattern } from "@/lib/codex-auth-contract";
import { cancelCodexDeviceLogin } from "@/lib/runner";

export const runtime = "nodejs";

const loginIdSchema = z
  .string()
  .trim()
  .regex(codexLoginIdPattern, "Invalid Codex authentication login ID");

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/runtimes/codex/auth/device-login/[loginId]">,
) {
  try {
    const { loginId } = await context.params;
    return Response.json({
      data: await cancelCodexDeviceLogin(loginIdSchema.parse(loginId)),
    });
  } catch (error) {
    return codexAuthApiError(error, "Could not cancel Codex authentication");
  }
}
