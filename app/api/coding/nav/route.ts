import { codingRepository } from "@/lib/repositories/coding-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ data: { attention: codingRepository.countWaitingRuns() } });
}
