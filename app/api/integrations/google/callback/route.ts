import { completeGoogleOAuthCallback } from "@/lib/integrations/google-oauth-service";
import { publicRequestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = await completeGoogleOAuthCallback({
    state: url.searchParams.get("state") ?? "",
    code: url.searchParams.get("code") ?? "",
    providerError: url.searchParams.has("error"),
  });
  const path = result.destination === "integrations" ? "/integrations" : "/settings";
  const redirect = new URL(path, publicRequestOrigin(request));

  if (result.destination === "integrations") {
    redirect.searchParams.set("google", result.status);
    if (result.integrationId) {
      redirect.searchParams.set("integration", result.integrationId);
    }
  } else {
    redirect.searchParams.set("tab", result.destination);
    redirect.searchParams.set(
      result.destination === "email" ? "email" : "calendar",
      result.status,
    );
  }

  return Response.redirect(redirect);
}
