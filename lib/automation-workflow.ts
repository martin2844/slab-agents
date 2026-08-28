import { z } from "zod";

export const emailAutomationMatchSchema = z.object({
  recipientAddress: z.string().trim().email().nullable().default(null),
  senderAddress: z.string().trim().email().nullable().default(null),
  senderDomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/)
    .max(253)
    .nullable()
    .default(null),
  subjectIncludes: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .nullable()
    .default(null),
});

export const automationWorkflowStepSchema = z.object({
  id: z.string().trim().min(1).max(100),
  type: z.enum(["agent_task", "agent_review"]),
  agentId: z.string().uuid(),
  action: z.enum(["analyze", "draft_reply", "review_and_reply"]),
  prompt: z.string().trim().min(2).max(20_000),
});

const persistedAutomationWorkflowStepSchema =
  automationWorkflowStepSchema.extend({
    /** Migration-only compatibility marker. Never accepted by public APIs. */
    legacyUnrestricted: z.literal(true).optional(),
  });

function workflowStepsSchema<T extends typeof automationWorkflowStepSchema>(
  stepSchema: T,
) {
  return z
  .array(stepSchema)
  .min(1)
  .max(8)
  .superRefine((steps, context) => {
    const ids = new Set<string>();
    let replyActions = 0;
    for (const [index, step] of steps.entries()) {
      if (ids.has(step.id)) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "Workflow step IDs must be unique.",
        });
      }
      ids.add(step.id);
      const expectedType =
        step.action === "review_and_reply" ? "agent_review" : "agent_task";
      if (step.type !== expectedType) {
        context.addIssue({
          code: "custom",
          path: [index, "type"],
          message:
            step.action === "review_and_reply"
              ? "Review-and-reply must be an agent review step."
              : "Analyze and draft actions must be agent task steps.",
        });
      }
      if (step.action === "review_and_reply") {
        replyActions += 1;
        if (index !== steps.length - 1) {
          context.addIssue({
            code: "custom",
            path: [index, "action"],
            message: "A review-and-reply step must be the final step.",
          });
        }
      }
    }
    if (replyActions > 1) {
      context.addIssue({
        code: "custom",
        message: "A workflow can contain at most one reply action.",
      });
    }
  });
}

export const automationWorkflowStepsSchema = workflowStepsSchema(
  automationWorkflowStepSchema,
);
export const persistedAutomationWorkflowStepsSchema = workflowStepsSchema(
  persistedAutomationWorkflowStepSchema,
);

export type EmailAutomationMatch = z.infer<
  typeof emailAutomationMatchSchema
>;
export type AutomationWorkflowStep = z.infer<
  typeof automationWorkflowStepSchema
>;
export type PersistedAutomationWorkflowStep = z.infer<
  typeof persistedAutomationWorkflowStepSchema
>;

export function nextAutomationWorkflowStepId(
  steps: Array<Pick<AutomationWorkflowStep, "id">>,
) {
  const existing = new Set(steps.map(({ id }) => id));
  let sequence = 1;
  while (existing.has(`draft-step-${sequence}`)) sequence += 1;
  return `draft-step-${sequence}`;
}

export function normalizePersistedAutomationWorkflowSteps(value: unknown) {
  if (!Array.isArray(value)) return value;
  return value.map((step) => {
    if (!step || typeof step !== "object") return step;
    const record = step as Record<string, unknown>;
    if (
      record.action !== "analyze" &&
      record.action !== "draft_reply" &&
      record.action !== "review_and_reply"
    ) {
      return step;
    }
    return {
      ...record,
      type:
        record.action === "review_and_reply" ? "agent_review" : "agent_task",
    };
  });
}

export const EMPTY_EMAIL_AUTOMATION_MATCH: EmailAutomationMatch = {
  recipientAddress: null,
  senderAddress: null,
  senderDomain: null,
  subjectIncludes: null,
};

export function matchesEmailAutomation(
  match: EmailAutomationMatch,
  event: {
    from: { address: string };
    to: Array<{ address: string }>;
    subject: string;
  },
) {
  const sender = event.from.address.trim().toLowerCase();
  const recipients = event.to.map(({ address }) =>
    address.trim().toLowerCase(),
  );
  return (
    (!match.recipientAddress ||
      recipients.includes(match.recipientAddress.toLowerCase())) &&
    (!match.senderAddress ||
      sender === match.senderAddress.toLowerCase()) &&
    (!match.senderDomain ||
      sender.endsWith(`@${match.senderDomain.toLowerCase()}`)) &&
    (!match.subjectIncludes ||
      event.subject
        .toLowerCase()
        .includes(match.subjectIncludes.toLowerCase()))
  );
}

export function defaultEmailWorkflow(input: {
  automationId?: string;
  agentId: string;
  prompt: string;
}): AutomationWorkflowStep[] {
  return [
    {
      id: input.automationId ? `step-${input.automationId}` : "step-1",
      type: "agent_task",
      agentId: input.agentId,
      action: "analyze",
      prompt: input.prompt,
    },
  ];
}
