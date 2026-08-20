import { NextResponse } from "next/server";
import { completeGmailConnection } from "@/lib/integrations/email-service";
import { emailSettingsRedirect } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(
      emailSettingsRedirect(request, "oauth_failed"),
    );
  }
  try {
    await completeGmailConnection(code, state);
    return NextResponse.redirect(emailSettingsRedirect(request, "connected"));
  } catch {
    return NextResponse.redirect(
      emailSettingsRedirect(request, "oauth_failed"),
    );
  }
}
