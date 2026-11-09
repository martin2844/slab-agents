import { OperationalError } from "@/lib/operational-error";
import type { Automation } from "@/lib/types";
import { whatsappAutomationSchema } from "@/lib/whatsapp-automation";

export function assertAutomationTriggerConfiguration(input: {
  triggerType: Automation["triggerType"];
  cronExpression: string | null;
  emailAccountId: string | null;
  emailMatch?: unknown;
  steps?: unknown[];
  whatsapp?: unknown;
}) {
  if (input.triggerType === "whatsapp") {
    whatsappAutomationSchema.parse(input.whatsapp);
    if (
      input.cronExpression !== null ||
      input.emailAccountId !== null ||
      input.emailMatch !== undefined ||
      (input.steps?.length ?? 0) > 0
    )
      throw new OperationalError(
        "WhatsApp automations cannot use Email workflows or schedules.",
        "INVALID_AUTOMATION_TRIGGER",
      );
    return;
  }
  if (input.whatsapp != null)
    throw new OperationalError(
      "Only WhatsApp triggers can select WhatsApp contacts.",
      "INVALID_AUTOMATION_TRIGGER",
    );
  if (input.triggerType === "email") {
    if (!input.emailAccountId || input.cronExpression !== null) {
      throw new OperationalError(
        "Email automations require one receiving account and cannot use a cron schedule.",
        "INVALID_AUTOMATION_TRIGGER",
      );
    }
    return;
  }
  if (input.emailAccountId !== null) {
    throw new OperationalError(
      "Scheduled automations cannot select an Email account.",
      "INVALID_AUTOMATION_TRIGGER",
    );
  }
  if (input.emailMatch !== undefined || input.steps !== undefined) {
    throw new OperationalError(
      "Scheduled automations cannot define an Email workflow.",
      "INVALID_AUTOMATION_TRIGGER",
    );
  }
}
