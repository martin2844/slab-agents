import { runRepository } from "@/lib/repositories/run-repository";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ data: runRepository.listAgentActivityRuns() });
}
