import { CronExpressionParser } from "cron-parser";
import { z } from "zod";

export const cronExpressionSchema = z
  .string()
  .min(5)
  .superRefine((value, ctx) => {
    try {
      CronExpressionParser.parse(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Invalid cron expression" });
    }
  });

export const automationCreateSchema = z.object({
  name: z.string().min(2),
  agentId: z.string().uuid(),
  cronExpression: cronExpressionSchema.nullable(),
  prompt: z.string().min(2),
  mode: z.enum(["review", "task"]).default("review"),
  enabled: z.boolean().default(true),
});

export const automationUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().min(2).optional(),
  cronExpression: cronExpressionSchema.nullable().optional(),
  prompt: z.string().min(2).optional(),
  mode: z.enum(["review", "task"]).optional(),
});
