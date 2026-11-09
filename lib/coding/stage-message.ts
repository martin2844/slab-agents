// Builds the stage contract message that the orchestrator sends to each stage run. Pure.

import { STAGE_DEFINITIONS, type CodingStage } from "@/lib/coding/stages";

export type StageMessageRepository = {
  fullName: string;
  defaultBranch: string;
  setupCommand: string | null;
  testCommand: string | null;
  lintCommand: string | null;
  typecheckCommand: string | null;
  setupNotes: string;
  repoPath: string;
  baseSha: string | null;
  prUrl: string | null;
  prState: string | null;
};

export type StageMessageInput = {
  number: number;
  issueKey: string;
  title: string;
  stage: CodingStage;
  attempt: number;
  /** The first repository is the primary one: the working directory of the agent. */
  repositories: StageMessageRepository[];
  branch: string;
  handoffPath: string;
  availableInputs: string[];
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
  const multi = input.repositories.length > 1;
  const lines = [
    `You run one stage of a Slab coding run.`,
    "",
    `- Coding run: #${input.number} · Work item: ${input.issueKey} — ${input.title}`,
    `- Stage: ${input.stage} (${definition.name}), attempt ${input.attempt}`,
    `- Branch: ${input.branch} (already created and checked out in every repository)`,
    `- Handoff folder: ${input.handoffPath}`,
    `- Inputs (read them from the handoff folder): ${inputs.length ? inputs.join(", ") : "none"}`,
    output ? `- Output: write ${output} in the handoff folder` : "- Output: none (answer in this conversation)",
    "",
    multi
      ? `This run changes ${input.repositories.length} repositories. Each one has its own checkout and its own pull request. Change only the repositories that the work needs; Slab publishes only the repositories with commits.`
      : "Repository:",
  ];
  input.repositories.forEach((repository, index) => {
    lines.push(
      `${multi ? `${index + 1}. ` : ""}${repository.fullName}${multi && index === 0 ? " (primary, your working directory)" : ""}`,
      `   - Checkout: ${repository.repoPath} · default branch ${repository.defaultBranch}${repository.baseSha ? ` · base commit ${repository.baseSha}` : ""}`,
      `   - Commands: setup ${command(repository.setupCommand)} · test ${command(repository.testCommand)} · lint ${command(repository.lintCommand)} · typecheck ${command(repository.typecheckCommand)}`,
      `   - Pull request: ${repository.prUrl ? `${repository.prUrl} (${repository.prState ?? "unknown state"})` : "not opened yet"}`,
      "   - Setup notes:",
      repository.setupNotes.trim()
        ? repository.setupNotes.trim().split("\n").map((line) => `     ${line}`).join("\n")
        : "     (none yet)",
    );
  });
  if (multi) {
    lines.push(
      "",
      "In reports, name the repository of each commit, check, and finding. In the engineer report, write the \"Repo setup notes\" section with one `### owner/name` subsection per repository.",
    );
  }
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
    `3. Write only inside the ${multi ? "checkouts" : "checkout"} and the handoff folder. Commit in each repository separately.`,
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
