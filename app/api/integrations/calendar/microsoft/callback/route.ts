import { finishMicrosoftCalendarOAuth } from "@/lib/integrations/calendar-service";
import { publicRequestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const redirect = new URL("/settings", publicRequestOrigin(request));
  redirect.searchParams.set("tab", "calendar");
  try {
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? "";
    if (!state || !code || url.searchParams.has("error")) {
      throw new Error("Microsoft authorization was cancelled or incomplete.");
    }
    await finishMicrosoftCalendarOAuth(state, code);
    redirect.searchParams.set("calendar", "connected");
  } catch {
    redirect.searchParams.set("calendar", "failed");
  }
  return Response.redirect(redirect);
}
