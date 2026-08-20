import { databaseReadiness } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    const readiness = databaseReadiness();
    return Response.json(
      {
        status: readiness.ready ? "ready" : "not_ready",
        service: "slab-agents",
        database: readiness,
      },
      { status: readiness.ready ? 200 : 503 },
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
