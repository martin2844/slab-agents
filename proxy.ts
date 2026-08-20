import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  authenticationRequired,
  sameOriginRequest,
  validateSession,
} from "@/lib/auth/service";

const publicPaths = new Set([
  "/health",
  "/ready",
  "/login",
  "/api/auth/login",
  "/api/auth/status",
]);
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

function internalMcpPath(pathname: string) {
  return /^\/api\/integrations\/[^/]+\/mcp$/.test(pathname);
}

export async function proxy(request: NextRequest) {
  if (!authenticationRequired()) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (publicPaths.has(pathname) || internalMcpPath(pathname)) {
    return NextResponse.next();
  }

  const authenticated = validateSession(
    request.cookies.get(AUTH_COOKIE_NAME)?.value,
  );
  if (!authenticated) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          error: {
            code: "AUTHENTICATION_REQUIRED",
            message: "Authentication is required.",
          },
        },
        { status: 401 },
      );
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  if (!safeMethods.has(request.method) && !sameOriginRequest(request)) {
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

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
