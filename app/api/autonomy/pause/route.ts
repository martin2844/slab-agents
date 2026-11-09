import { getAutonomyOverview } from "@/lib/autonomy/overview";
import { pauseAutonomy } from "@/lib/autonomy/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  pauseAutonomy();
  return Response.json({ data: getAutonomyOverview() });
}
