import { z } from "zod";
import { apiError } from "@/lib/api";
import { getAutonomyOverview } from "@/lib/autonomy/overview";
import { updateAutonomyPolicy } from "@/lib/autonomy/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ data: getAutonomyOverview() });
}

const limitsSchema = z
  .object({
    planningEveryHours: z.number(),
    digestHour: z.number().nullable(),
    timezone: z.string().max(100),
    maxConcurrentRuns: z.number(),
    runTimeLimitMinutes: z.number(),
    maxDelegationDepth: z.number(),
    maxAutonomousRunsPerDay: z.number(),
    outboundDailyCap: z.number(),
    approvalRemindMinutes: z.number(),
    approvalDenyHours: z.number(),
    questionWaitHours: z.number(),
  })
  .partial();

const patchSchema = z.object({
  level: z.number().int().min(0).max(3).optional(),
  overrides: z.record(z.string(), z.string().nullable()).optional(),
  limits: limitsSchema.optional(),
  leadAgentId: z.string().nullable().optional(),
  planningPrompt: z.string().max(20_000).optional(),
  agentCaps: z.record(z.string(), z.number().int().min(0).max(3).nullable()).optional(),
});

export async function PUT(request: Request) {
  try {
    updateAutonomyPolicy(patchSchema.parse(await request.json()));
    return Response.json({ data: getAutonomyOverview() });
  } catch (error) {
    return apiError(error, "Could not save the autonomy settings.");
  }
}
