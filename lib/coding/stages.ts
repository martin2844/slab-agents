// Stage definitions for Slab coding runs. Pure data: safe for server and client code.

export const PIPELINE_STAGES = [
  "pm",
  "tech_spec",
  "plan_review",
  "engineer",
  "code_review",
  "publish",
  "final_pass",
] as const;

export const SIDE_STAGES = ["pr_feedback", "chat"] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export type SideStage = (typeof SIDE_STAGES)[number];
export type CodingStage = PipelineStage | SideStage;
export type AgentStage = Exclude<CodingStage, "publish">;

export const AGENT_STAGES: AgentStage[] = [
  "pm",
  "tech_spec",
  "plan_review",
  "engineer",
  "code_review",
  "final_pass",
  "pr_feedback",
  "chat",
];

export type StageGate = "approve" | "auto" | "verdict" | "publish" | "manual";

export type StageDefinition = {
  id: CodingStage;
  name: string;
  title: string;
  blurb: string;
  inputs: string[];
  output: string | null;
  gate: StageGate;
  autoRetries: number;
};

export const STAGE_DEFINITIONS: Record<CodingStage, StageDefinition> = {
  pm: {
    id: "pm",
    name: "PM",
    title: "PM",
    blurb:
      "Collects context from the Work item, Docs, and the repository. Writes the product spec.",
    inputs: ["run.md"],
    output: "spec.md",
    gate: "approve",
    autoRetries: 2,
  },
  tech_spec: {
    id: "tech_spec",
    name: "Tech spec",
    title: "Tech Lead",
    blurb: "Reads the code and writes a step-by-step plan.",
    inputs: ["run.md", "spec.md", "review.md"],
    output: "plan.md",
    gate: "auto",
    autoRetries: 2,
  },
  plan_review: {
    id: "plan_review",
    name: "Plan review",
    title: "Plan Reviewer",
    blurb:
      "Scores the plan against a fixed rubric. Sends it back when it is not ready.",
    inputs: ["spec.md", "plan.md"],
    output: "review.md",
    gate: "verdict",
    autoRetries: 2,
  },
  engineer: {
    id: "engineer",
    name: "Engineer",
    title: "Engineer",
    blurb: "Executes the plan on the run branch. Commits each step and runs the checks.",
    inputs: ["spec.md", "plan.md", "review.md"],
    output: "engineer.md",
    gate: "auto",
    autoRetries: 2,
  },
  code_review: {
    id: "code_review",
    name: "Code review",
    title: "Code Reviewer",
    blurb:
      "Reviews and fixes the branch. Approving it publishes the branch and opens a draft PR.",
    inputs: ["spec.md", "plan.md", "engineer.md"],
    output: "code-review.md",
    gate: "publish",
    autoRetries: 2,
  },
  publish: {
    id: "publish",
    name: "Publish",
    title: "Publish",
    blurb: "Pushes the run branch and opens or updates the draft pull request.",
    inputs: [],
    output: null,
    gate: "auto",
    autoRetries: 0,
  },
  final_pass: {
    id: "final_pass",
    name: "Final pass",
    title: "Release Writer",
    blurb: "Writes the pull request description. Slab applies it to the PR.",
    inputs: ["spec.md", "engineer.md", "code-review.md"],
    output: "final.md",
    gate: "auto",
    autoRetries: 2,
  },
  pr_feedback: {
    id: "pr_feedback",
    name: "PR feedback",
    title: "PR Fixer",
    blurb:
      "Triages review comments, fixes the accepted ones, and drafts replies.",
    inputs: ["spec.md", "plan.md", "feedback-items.json"],
    output: "feedback-triage.json",
    gate: "manual",
    autoRetries: 1,
  },
  chat: {
    id: "chat",
    name: "Run chat",
    title: "Run chat",
    blurb: "Ask about the run or request changes on the branch.",
    inputs: [],
    output: null,
    gate: "manual",
    autoRetries: 0,
  },
};

export function nextPipelineStage(stage: CodingStage): PipelineStage | null {
  const index = PIPELINE_STAGES.indexOf(stage as PipelineStage);
  if (index < 0 || index === PIPELINE_STAGES.length - 1) return null;
  return PIPELINE_STAGES[index + 1] ?? null;
}

export function isPipelineStage(value: string): value is PipelineStage {
  return (PIPELINE_STAGES as readonly string[]).includes(value);
}

export function isCodingStage(value: string): value is CodingStage {
  return value in STAGE_DEFINITIONS;
}

/** The PM writes the spec; the Engineer runs every other stage with that stage's instructions. */
export const DEFAULT_STAGE_AGENT_SLUGS: Record<AgentStage, string> = {
  pm: "code-pm",
  tech_spec: "code-engineer",
  plan_review: "code-engineer",
  engineer: "code-engineer",
  code_review: "code-engineer",
  final_pass: "code-engineer",
  pr_feedback: "code-engineer",
  chat: "code-engineer",
};

export type CodeRunStatus =
  | "preparing"
  | "active"
  | "waiting"
  | "done"
  | "failed"
  | "cancelled";

export type CodeStageStatus =
  | "queued"
  | "running"
  | "needs_input"
  | "waiting_approval"
  | "done"
  | "failed"
  | "cancelled";

export const OPEN_RUN_STATUSES: CodeRunStatus[] = [
  "preparing",
  "active",
  "waiting",
];

export const STAGE_STATUS_LABELS: Record<CodeStageStatus, string> = {
  queued: "Queued",
  running: "Running",
  needs_input: "Needs input",
  waiting_approval: "Waiting for approval",
  done: "Done",
  failed: "Failed",
  cancelled: "Stopped",
};

export const RUN_STATUS_LABELS: Record<CodeRunStatus, string> = {
  preparing: "Preparing",
  active: "Running",
  waiting: "Waiting for you",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

/**
 * Badge for a run: a waiting run is not always waiting for an approval. When
 * its current stage failed (for example publishing), show that instead.
 */
export function runBadgeStatus(
  run: { status: CodeRunStatus; currentStage: string },
  stages: Array<{ stage: string; status: CodeStageStatus; attempt: number; superseded?: boolean }>,
) {
  if (run.status === "active") return "running";
  if (run.status !== "waiting") return run.status;
  const current = stages
    .filter((item) => item.stage === run.currentStage && !item.superseded)
    .sort((a, b) => b.attempt - a.attempt)[0];
  if (current?.status === "failed") return "failed";
  if (current?.status === "needs_input") return "needs_input";
  return "waiting_approval";
}
