import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AUTH_COOKIE_NAME,
  AUTH_SESSION_MAX_AGE_SECONDS,
  authenticateAdmin,
  loginClientIdentifier,
  sameOriginRequest,
  secureRequest,
} from "@/lib/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ password: z.string().min(1).max(1024) });

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_ORIGIN",
          message: "Request origin is invalid.",
        },
      },
      { status: 403 },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_CREDENTIALS", message: "Invalid password." } },
      { status: 401 },
    );
  }

  const result = await authenticateAdmin(
    parsed.data.password,
    loginClientIdentifier(request),
  );
  if (!result.ok) {
    if (result.code === "RATE_LIMITED") {
      return NextResponse.json(
        {
          error: {
            code: result.code,
            message: "Too many login attempts. Try again shortly.",
          },
        },
        {
          status: 429,
          headers: { "Retry-After": String(result.retryAfterSeconds) },
        },
      );
    }
    if (result.code === "SETUP_REQUIRED") {
      return NextResponse.json(
        {
          error: {
            code: result.code,
            message: "Administrator credentials have not been configured.",
          },
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: { code: result.code, message: "Invalid password." } },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ data: { authenticated: true } });
  response.cookies.set(AUTH_COOKIE_NAME, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureRequest(request),
    path: "/",
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
