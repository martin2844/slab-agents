import { NextResponse } from "next/server";
import { completeGmailConnection } from "@/lib/integrations/email-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const redirect = new URL("/integrations", url.origin);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    redirect.searchParams.set("email", "oauth_failed");
    return NextResponse.redirect(redirect);
  }
  try {
    await completeGmailConnection(code, state);
    redirect.searchParams.set("email", "connected");
  } catch {
    redirect.searchParams.set("email", "oauth_failed");
  }
  return NextResponse.redirect(redirect);
}
