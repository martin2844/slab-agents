import { NextResponse } from "next/server";
import { z } from "zod";
import { AUTH_COOKIE_NAME, rotateAdminPassword } from "@/lib/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(12).max(1024),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_PASSWORD",
          message: "The new password must contain at least 12 characters.",
        },
      },
      { status: 400 },
    );
  }

  const changed = await rotateAdminPassword(
    parsed.data.currentPassword,
    parsed.data.newPassword,
  );
  if (!changed) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_PASSWORD",
          message: "The current password is incorrect.",
        },
      },
      { status: 401 },
    );
  }

  const response = NextResponse.json({
    data: { changed: true, authenticated: false },
  });
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
  return response;
}
