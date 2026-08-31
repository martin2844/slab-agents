import { CronExpressionParser } from "cron-parser";
import { z } from "zod";
import {
  automationWorkflowStepsSchema,
  emailAutomationMatchSchema,
} from "../automation-workflow.ts";
import { isValidTimeZone } from "../automation-schedule.ts";

const lifecycleStatusSchema = z.enum([
  "draft",
  "enabled",
  "paused",
  "archived",
]);
const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(isValidTimeZone, "Choose a valid IANA timezone.");

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

export const automationCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    agentId: z.string().uuid(),
    triggerType: z.enum(["schedule", "email"]).default("schedule"),
    cronExpression: cronExpressionSchema.nullable(),
    scheduleTimezone: timezoneSchema.default("UTC"),
    emailAccountId: z.string().min(1).max(200).nullable().default(null),
    emailMatch: emailAutomationMatchSchema.optional(),
    steps: automationWorkflowStepsSchema.optional(),
    prompt: z.string().trim().min(2).max(20_000),
    mode: z.enum(["review", "task"]).default("review"),
    enabled: z.boolean().default(true),
    lifecycleStatus: lifecycleStatusSchema.optional(),
    missedRunPolicy: z.enum(["skip", "latest_once"]).default("latest_once"),
  })
  .superRefine((input, ctx) => {
    if (input.triggerType === "email" && !input.emailAccountId) {
      ctx.addIssue({
        code: "custom",
        path: ["emailAccountId"],
        message: "Choose the Email account that receives this message.",
      });
    }
    if (input.triggerType === "email" && input.cronExpression) {
      ctx.addIssue({
        code: "custom",
        path: ["cronExpression"],
        message: "Email automations cannot also use a cron schedule.",
      });
    }
    if (
      input.triggerType === "email" &&
      input.steps?.[0]?.agentId !== undefined &&
      input.steps[0].agentId !== input.agentId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["steps", 0, "agentId"],
        message: "The first workflow step must use the automation agent.",
      });
    }
    if (input.triggerType === "schedule" && input.emailAccountId) {
      ctx.addIssue({
        code: "custom",
        path: ["emailAccountId"],
        message: "Scheduled automations cannot select an Email account.",
      });
    }
    if (input.triggerType === "schedule" && input.steps?.length) {
      ctx.addIssue({
        code: "custom",
        path: ["steps"],
        message: "Scheduled automations do not use an Email workflow.",
      });
    }
    if (input.triggerType === "schedule" && input.emailMatch !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["emailMatch"],
        message: "Scheduled automations do not use Email matching rules.",
      });
    }
  });

const workflowDefinitionFields = [
  "agentId",
  "cronExpression",
  "scheduleTimezone",
  "emailAccountId",
  "prompt",
  "mode",
  "emailMatch",
  "steps",
  "missedRunPolicy",
] as const;

export const automationUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    expectedWorkflowVersion: z.number().int().positive().optional(),
    agentId: z.string().uuid().optional(),
    name: z.string().trim().min(2).max(120).optional(),
    cronExpression: cronExpressionSchema.nullable().optional(),
    scheduleTimezone: timezoneSchema.optional(),
    emailAccountId: z.string().min(1).max(200).nullable().optional(),
    prompt: z.string().trim().min(2).max(20_000).optional(),
    mode: z.enum(["review", "task"]).optional(),
    emailMatch: emailAutomationMatchSchema.optional(),
    steps: automationWorkflowStepsSchema.optional(),
    lifecycleStatus: lifecycleStatusSchema.optional(),
    missedRunPolicy: z.enum(["skip", "latest_once"]).optional(),
  })
  .superRefine((input, context) => {
    const changesWorkflowDefinition = workflowDefinitionFields.some(
      (field) => input[field] !== undefined,
    );
    if (
      changesWorkflowDefinition &&
      input.expectedWorkflowVersion === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["expectedWorkflowVersion"],
        message:
          "expectedWorkflowVersion is required when changing an automation workflow.",
      });
    }
  });

export const automationPreviewSchema = z.discriminatedUnion("triggerType", [
  z.object({
    triggerType: z.literal("schedule"),
    cronExpression: cronExpressionSchema.nullable(),
    scheduleTimezone: timezoneSchema,
  }),
  z.object({
    triggerType: z.literal("email"),
    emailMatch: emailAutomationMatchSchema,
    steps: automationWorkflowStepsSchema,
    sample: z.object({
      senderAddress: z.string().trim().email(),
      recipientAddresses: z.array(z.string().trim().email()).min(1).max(20),
      subject: z.string().trim().max(500),
    }),
  }),
]);
