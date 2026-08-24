import { z } from "zod";
import { apiError } from "@/lib/api";
import {
  getBudgetConfiguration,
  updateBudgetConfiguration,
} from "@/lib/budget-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nullablePositive = z.number().positive().max(1_000_000).nullable();
const schema = z.object({
  expectedVersion: z.number().int().positive(),
  workspace: z.object({
    maxTokensPerRun: z.number().int().positive().max(10_000_000_000).nullable(),
    maxCostUsdPerRun: nullablePositive,
    dailyCostUsd: nullablePositive,
    monthlyCostUsd: nullablePositive,
  }),
  agents: z
    .array(
      z.object({
        agentId: z.string().uuid(),
        maxTokensPerRun: z
          .number()
          .int()
          .positive()
          .max(10_000_000_000)
          .nullable(),
        maxCostUsdPerRun: nullablePositive,
      }),
    )
    .max(100),
  prices: z
    .array(
      z
        .object({
          runtimeId: z.string().trim().min(1).max(64),
          model: z.string().trim().min(1).max(200),
          inputUsdPerMillion: z.number().nonnegative().max(1_000_000),
          cachedInputUsdPerMillion: z.number().nonnegative().max(1_000_000),
          outputUsdPerMillion: z.number().nonnegative().max(1_000_000),
        })
        .refine(
          (price) =>
            price.inputUsdPerMillion +
              price.cachedInputUsdPerMillion +
              price.outputUsdPerMillion >
            0,
          "A pricing entry must include at least one non-zero rate.",
        ),
    )
    .max(500),
});

export function GET() {
  return Response.json({ data: getBudgetConfiguration() });
}

export async function PATCH(request: Request) {
  try {
    return Response.json({
      data: updateBudgetConfiguration(schema.parse(await request.json())),
    });
  } catch (error) {
    return apiError(error);
  }
}
