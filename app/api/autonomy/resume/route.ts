import { getAutonomyOverview } from "@/lib/autonomy/overview";
import { resumeAutonomy } from "@/lib/autonomy/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  resumeAutonomy();
  return Response.json({ data: getAutonomyOverview() });
}
