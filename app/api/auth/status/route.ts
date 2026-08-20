import { authStatus } from "@/lib/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ data: authStatus() });
}
