import { databaseReadiness } from "@/lib/health";
import { authenticationReadiness } from "@/lib/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    const readiness = databaseReadiness();
    const authentication = authenticationReadiness();
    const ready = readiness.ready && authentication.ready;
    return Response.json(
      {
        status: ready ? "ready" : "not_ready",
        service: "slab-agents",
        database: readiness,
        authentication,
      },
      { status: ready ? 200 : 503 },
    );
  } catch {
    return Response.json(
      {
        status: "not_ready",
        service: "slab-agents",
        database: { ready: false },
      },
      { status: 503 },
    );
  }
}
