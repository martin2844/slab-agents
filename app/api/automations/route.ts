import { z } from "zod";
import { CronExpressionParser } from "cron-parser";
import { apiError } from "@/lib/api";
import { repository } from "@/lib/repository";
export const dynamic = "force-dynamic";
const schema = z
  .object({
    name: z.string().min(2),
    agentId: z.string().uuid(),
    cronExpression: z.string().min(5).nullable(),
    prompt: z.string().min(2),
    enabled: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.cronExpression) {
      try {
        CronExpressionParser.parse(v.cronExpression);
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "Invalid cron expression",
          path: ["cronExpression"],
        });
      }
    }
  });
export async function GET() {
  return Response.json({ data: repository.listAutomations() });
}
export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    if (!repository.getAgent(input.agentId)) throw new Error("Agent not found");
    return Response.json(
      { data: repository.createAutomation(input) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
