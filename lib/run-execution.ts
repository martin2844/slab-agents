export type RunTrigger =
  | "chat"
  | "manual"
  | "automation"
  | "email"
  | "whatsapp"
  | "assignment"
  | "resumed"
  | "review_requested"
  | "blocked"
  | "mention"
  | "coding";

export type RunMode =
  | "chat"
  | "task"
  | "review"
  | "assignment"
  | "work_item"
  | "code_stage";

export type AutomationMode = Extract<RunMode, "review" | "task">;

export type RunExecution = {
  trigger: RunTrigger;
  mode: RunMode;
  issueKey: string | null;
  policy: string;
};

export type RuntimeThreadPlan = {
  runtimeThreadId: string | null;
  continuity: "fresh" | "resumed";
  reusable: boolean;
};

export function planRuntimeThread(
  mode: RunMode,
  persistedRuntimeThreadId: string | null,
): RuntimeThreadPlan {
  // Coding stages keep one runtime thread per stage, so answers to questions
  // and retries continue the same conversation.
  const reusable = mode === "chat" || mode === "code_stage";
  const runtimeThreadId = reusable ? persistedRuntimeThreadId : null;
  return {
    runtimeThreadId,
    continuity: runtimeThreadId ? "resumed" : "fresh",
    reusable,
  };
}

const REVIEW_POLICY = [
  "Perform an operational review.",
  "Review existing Work before creating new work.",
  "There is no obligation to create tasks.",
  "Search for duplicates before creating work.",
  "Prioritize a small number of material actions.",
  "Do not turn every unknown into a new issue.",
  "Delegate only actionable work.",
  "If nothing material requires action, it is valid to finish without changes.",
  "This run has no associated Work item. Do not adopt an arbitrary issue as its scope.",
].join("\n");

const WORK_DELIVERABLE_POLICY = [
  "Evaluate completion against the requested deliverable of the current Work item, not against every downstream action that could follow from it.",
  "Use done when the requested deliverable is sufficiently and verifiably complete, even if recommendations, future decisions, follow-ups, or separate work remain.",
  "Use review only when that same deliverable was produced but explicitly requires approval, acceptance, or validation before it can be considered complete; do not use review merely because there is a next step.",
  "Use blocked only when the currently requested deliverable cannot be produced with the available information or capabilities.",
].join("\n");

const CODE_STAGE_POLICY = [
  "This run is one stage of a Slab coding run on the associated Work item.",
  "Follow the stage contract in the task input exactly: inputs, output file, and git rules.",
  "Work in the repository checkouts and the handoff folder only.",
  "Never push, never open pull requests, and never change the Work item status; Slab does this.",
].join("\n");

const MODE_POLICIES: Record<
  Exclude<RunMode, "review" | "assignment">,
  string
> = {
  code_stage: CODE_STAGE_POLICY,
  chat: [
    "Respond to the user's current conversation.",
    "The conversation is the primary context for this run.",
    "There is no associated Work item unless the user explicitly introduces one.",
    "Use Work, Docs, and available integrations only when they help answer the user's request.",
  ].join("\n"),
  task: [
    "Complete the specific task provided for this run.",
    "There is no associated Work item. Do not adopt an arbitrary issue as the run scope.",
    "Use Work, Docs, and available integrations as needed for the requested outcome.",
  ].join("\n"),
  work_item: [
    "This run was triggered by activity on the associated Work item.",
    "Focus on that Work item and the event described in the task input.",
    "Read its current state and relevant context before acting.",
    "Document any result or decision on the Work item when appropriate.",
    "Do not turn this run into a general operational review.",
    WORK_DELIVERABLE_POLICY,
  ].join("\n"),
};

function assignmentPolicy(issueKey: string) {
  return [
    `You were assigned Work item ${issueKey}.`,
    "Focus on advancing this assigned Work item.",
    "Read the issue, comments, relations, and relevant Docs before acting.",
    "Use Work and Docs as needed, then document the result on the issue.",
    "Advance, block, request review, or complete the issue according to the available evidence.",
    "Do not turn this run into a general operational review.",
    WORK_DELIVERABLE_POLICY,
  ].join("\n");
}

function assertTriggerMode(trigger: RunTrigger, mode: RunMode) {
  if ((trigger === "chat" || trigger === "whatsapp") && mode !== "chat") {
    throw new Error("A chat trigger requires chat execution mode.");
  }
  if (
    (trigger === "assignment" || trigger === "resumed") &&
    mode !== "assignment"
  ) {
    throw new Error(`${trigger} requires assignment execution mode.`);
  }
  if (
    ["review_requested", "blocked", "mention"].includes(trigger) &&
    mode !== "work_item"
  ) {
    throw new Error(`${trigger} requires work_item execution mode.`);
  }
  if ((trigger === "coding") !== (mode === "code_stage")) {
    throw new Error("Coding stage runs require the coding trigger.");
  }
  if (
    (trigger === "manual" || trigger === "automation" || trigger === "email") &&
    !["review", "task"].includes(mode)
  ) {
    throw new Error(`${trigger} requires review or task execution mode.`);
  }
}

export function defineRunExecution(input: {
  trigger: RunTrigger;
  mode: RunMode;
  issueKey?: string | null;
  eventInstructions?: string | null;
}): RunExecution {
  const issueKey = input.issueKey?.trim() || null;
  const issueScoped =
    input.mode === "assignment" ||
    input.mode === "work_item" ||
    input.mode === "code_stage";

  assertTriggerMode(input.trigger, input.mode);
  if (issueScoped && !issueKey) {
    throw new Error(`${input.mode} execution requires an associated issue.`);
  }
  if (!issueScoped && issueKey) {
    throw new Error(`${input.mode} execution cannot have an associated issue.`);
  }

  const basePolicy =
    input.mode === "review"
      ? REVIEW_POLICY
      : input.mode === "assignment"
        ? assignmentPolicy(issueKey!)
        : MODE_POLICIES[input.mode];
  const eventInstructions = input.eventInstructions?.trim();

  return {
    trigger: input.trigger,
    mode: input.mode,
    issueKey,
    policy: eventInstructions
      ? `${basePolicy}\n\nTrigger-specific instructions:\n${eventInstructions}`
      : basePolicy,
  };
}
