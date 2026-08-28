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

export const automationWorkflowStepsSchema = z
  .array(automationWorkflowStepSchema)
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

export type EmailAutomationMatch = z.infer<
  typeof emailAutomationMatchSchema
>;
export type AutomationWorkflowStep = z.infer<
  typeof automationWorkflowStepSchema
>;

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
