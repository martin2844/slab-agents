// Builds the stage contract message that the orchestrator sends to each stage run. Pure.

import { STAGE_DEFINITIONS, type CodingStage } from "@/lib/coding/stages";

export type StageMessageInput = {
  number: number;
  issueKey: string;
  title: string;
  stage: CodingStage;
  attempt: number;
  repository: {
    fullName: string;
    defaultBranch: string;
    setupCommand: string | null;
    testCommand: string | null;
    lintCommand: string | null;
    typecheckCommand: string | null;
    setupNotes: string;
  };
  branch: string;
  baseSha: string | null;
  repoPath: string;
  handoffPath: string;
  availableInputs: string[];
  prUrl: string | null;
  prState: string | null;
  retryReason?: string | null;
  userMessage?: string | null;
  feedbackStep?: "triage" | "apply" | null;
  feedbackFixIds?: string[];
  feedbackDecidedIds?: string[];
};

const command = (value: string | null) => (value?.trim() ? `\`${value.trim()}\`` : "(not configured)");

export function buildStageMessage(input: StageMessageInput) {
  const definition = STAGE_DEFINITIONS[input.stage];
  const inputs = definition.inputs.filter((name) => input.availableInputs.includes(name));
  const output =
    input.stage === "pr_feedback"
      ? input.feedbackStep === "apply"
        ? "feedback-result.json"
        : "feedback-triage.json"
      : input.stage === "final_pass"
        ? "pr-body.md and final.md"
        : definition.output;
  const lines = [
    `You run one stage of a Slab coding run.`,
    "",
    `- Coding run: #${input.number} · Work item: ${input.issueKey} — ${input.title}`,
    `- Stage: ${input.stage} (${definition.name}), attempt ${input.attempt}`,
    `- Repository: ${input.repository.fullName} · default branch ${input.repository.defaultBranch}`,
    `- Branch: ${input.branch} (already created and checked out)${input.baseSha ? ` · base commit ${input.baseSha}` : ""}`,
    `- Checkout: ${input.repoPath}`,
    `- Handoff folder: ${input.handoffPath}`,
    `- Inputs (read them from the handoff folder): ${inputs.length ? inputs.join(", ") : "none"}`,
    output ? `- Output: write ${output} in the handoff folder` : "- Output: none (answer in this conversation)",
    `- Repo commands: setup ${command(input.repository.setupCommand)} · test ${command(input.repository.testCommand)} · lint ${command(input.repository.lintCommand)} · typecheck ${command(input.repository.typecheckCommand)}`,
    `- Pull request: ${input.prUrl ? `${input.prUrl} (${input.prState ?? "unknown state"})` : "not opened yet"}`,
    "- Repo setup notes:",
    input.repository.setupNotes.trim()
      ? input.repository.setupNotes.trim().split("\n").map((line) => `  ${line}`).join("\n")
      : "  (none yet)",
  ];
  if (input.stage === "pr_feedback") {
    lines.push(
      "",
      input.feedbackStep === "apply"
        ? `This is step 2 (apply). Fix only these approved items: ${(input.feedbackFixIds ?? []).join(", ") || "(none)"}.`
        : "This is step 1 (triage). Read feedback-items.json and write feedback-triage.json. Do not change code.",
    );
    if (input.feedbackDecidedIds?.length) {
      lines.push(`Already decided items (never handle them): ${input.feedbackDecidedIds.join(", ")}.`);
    }
  }
  if (input.retryReason?.trim()) {
    lines.push("", "This is a retry. Reason:", input.retryReason.trim());
  }
  lines.push(
    "",
    "Rules for every stage:",
    "1. There is no git remote. Never run `git push`, never create a pull request, never call the GitHub API. Slab publishes the branch after human approval.",
    "2. Never edit files under `.github/workflows/`. Never add secrets, tokens, or `.env` files to the repository.",
    "3. Write only inside the checkout and the handoff folder.",
  );
  if (output && input.stage !== "pr_feedback") {
    lines.push(
      "4. The output file starts with YAML frontmatter. `status` is required:",
      "   - `status: done` when the output is complete.",
      "   - `status: needs_input` when you need the user. Put each question in `questions:` as a list, and stop. The user answers in this same conversation, and you continue from there.",
      "5. After you write the output file, reply with one line: `DONE` or `NEEDS_INPUT`.",
    );
  }
  if (input.userMessage?.trim()) {
    lines.push("", "Message from the user:", input.userMessage.trim());
  }
  return lines.join("\n");
}

/** Follow-up message for a stage that continues in the same conversation. */
export function buildContinuationMessage(input: {
  stage: CodingStage;
  output: string | null;
  userMessage?: string | null;
  retryReason?: string | null;
}) {
  const lines: string[] = [];
  if (input.userMessage?.trim()) lines.push(input.userMessage.trim());
  if (input.retryReason?.trim()) {
    lines.push(
      lines.length ? "" : "",
      `Your previous attempt did not finish the stage: ${input.retryReason.trim()}`,
    );
  }
  if (input.output) {
    lines.push(
      "",
      `Continue the ${input.stage} stage with the same stage contract. Update ${input.output} in the handoff folder (status: done or needs_input), then reply DONE or NEEDS_INPUT.`,
    );
  }
  return lines.join("\n").trim();
}
