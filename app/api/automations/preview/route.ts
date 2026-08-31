import { apiError } from "@/lib/api";
import { automationPreviewSchema } from "@/lib/api-schemas/automation";
import { nextScheduledOccurrences } from "@/lib/automation-schedule";
import { matchesEmailAutomation } from "@/lib/automation-workflow";

export async function POST(request: Request) {
  try {
    const input = automationPreviewSchema.parse(await request.json());
    if (input.triggerType === "schedule") {
      return Response.json({
        data: {
          triggerType: "schedule",
          nextRuns: input.cronExpression
            ? nextScheduledOccurrences(
                input.cronExpression,
                new Date(),
                input.scheduleTimezone,
              ).map((date) => date.toISOString())
            : [],
        },
      });
    }
    const matched = matchesEmailAutomation(input.emailMatch, {
      from: { address: input.sample.senderAddress },
      to: input.sample.recipientAddresses.map((address) => ({ address })),
      subject: input.sample.subject,
    });
    return Response.json({
      data: {
        triggerType: "email",
        matched,
        ruleCount: [
          input.emailMatch.recipientAddress,
          input.emailMatch.senderAddress,
          input.emailMatch.senderDomain,
          input.emailMatch.subjectIncludes,
        ].filter(Boolean).length,
        steps: matched
          ? input.steps.map(({ id, action, agentId }, index) => ({
              id,
              position: index + 1,
              action,
              agentId,
            }))
          : [],
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
