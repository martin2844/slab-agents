import type { AutomationMode } from "@/lib/run-execution";
import type { AutomationWorkflowStep } from "@/lib/automation-workflow";

export type AutomationTemplate = {
  id: string;
  name: string;
  description: string;
  triggerType: "schedule" | "email";
  mode: AutomationMode;
  cronExpression: string | null;
  prompt: string;
  email?: {
    subjectIncludes?: string;
    steps: Array<Pick<AutomationWorkflowStep, "action" | "prompt">>;
  };
};

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: "weekly-okr-review",
    name: "Weekly OKR review",
    description: "Review progress, risks and blocked outcomes every Monday.",
    triggerType: "schedule",
    mode: "review",
    cronExpression: "0 9 * * 1",
    prompt:
      "Review current OKRs against open Work and supporting Docs. Summarize progress, risks, blocked outcomes, and the next action for each owner.",
  },
  {
    id: "pipeline-follow-up",
    name: "Pipeline follow-up",
    description:
      "Find commercial opportunities that need a concrete next step.",
    triggerType: "schedule",
    mode: "review",
    cronExpression: "0 10 * * 2,4",
    prompt:
      "Review the active sales pipeline. Identify opportunities with strong signal and no concrete next action, then update or delegate Work where appropriate.",
  },
  {
    id: "renewal-reminders",
    name: "Renewal reminders",
    description: "Review upcoming renewals at the start of each month.",
    triggerType: "schedule",
    mode: "task",
    cronExpression: "0 9 1 * *",
    prompt:
      "Review upcoming customer renewals, flag risk and prepare the next action for each account that needs attention.",
  },
  {
    id: "support-inbox-triage",
    name: "Support inbox triage",
    description: "Analyze new support messages and prepare a useful reply.",
    triggerType: "email",
    mode: "task",
    cronExpression: null,
    prompt:
      "Read the inbound request, identify the issue and prepare a factual reply.",
    email: {
      steps: [
        {
          action: "analyze",
          prompt: "Analyze the request, urgency and relevant account context.",
        },
        {
          action: "draft_reply",
          prompt: "Prepare a concise, factual reply using the analysis.",
        },
      ],
    },
  },
  {
    id: "bug-report-routing",
    name: "Bug report routing",
    description:
      "Recognize bug reports and route a structured internal outcome.",
    triggerType: "email",
    mode: "task",
    cronExpression: null,
    prompt:
      "Analyze the bug report and produce a structured engineering handoff.",
    email: {
      subjectIncludes: "bug",
      steps: [
        {
          action: "analyze",
          prompt:
            "Extract reproduction details, impact, urgency and missing information from the bug report.",
        },
      ],
    },
  },
];

export function getAutomationTemplate(id: string | undefined) {
  return AUTOMATION_TEMPLATES.find((template) => template.id === id) ?? null;
}
