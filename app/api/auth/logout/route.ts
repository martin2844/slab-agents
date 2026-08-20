import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, revokeSession } from "@/lib/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === AUTH_COOKIE_NAME)?.[1];
  revokeSession(cookie ? decodeURIComponent(cookie) : undefined);

  const response = NextResponse.json({ data: { authenticated: false } });
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
  return response;
}
