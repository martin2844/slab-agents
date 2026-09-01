import { finishGoogleDataOAuth } from "@/lib/integrations/google-data-service";
import { publicRequestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const redirect = new URL("/integrations", publicRequestOrigin(request));
  try {
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? "";
    if (!state || !code || url.searchParams.has("error")) {
      throw new Error("Google authorization was cancelled or incomplete.");
    }
    const integration = await finishGoogleDataOAuth(state, code);
    redirect.searchParams.set("google", "connected");
    redirect.searchParams.set("integration", integration.id);
  } catch {
    redirect.searchParams.set("google", "failed");
  }
  return Response.redirect(redirect);
}
