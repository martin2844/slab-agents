import type {
  CodeRunStatus,
  CodeStageStatus,
  CodingStage,
} from "@/lib/coding/stages";

export type CodeRepository = {
  id: string;
  sourceAppId: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  setupCommand: string | null;
  testCommand: string | null;
  lintCommand: string | null;
  typecheckCommand: string | null;
  setupNotes: string;
  workProjectKey: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CodeRun = {
  id: string;
  number: number;
  issueKey: string;
  title: string;
  repositoryId: string;
  status: CodeRunStatus;
  currentStage: CodingStage;
  workspaceId: string;
  workspaceStatus: "pending" | "preparing" | "ready" | "failed" | "deleted";
  branch: string;
  baseSha: string | null;
  headSha: string | null;
  note: string;
  prNumber: number | null;
  prUrl: string | null;
  prState: "draft" | "open" | "merged" | "closed" | null;
  ciState: "pending" | "success" | "failure" | "none" | null;
  prCheckedAt: string | null;
  lastPublishedSha: string | null;
  publishedAt: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  updatedAt: string;
};

export type CodeRunStage = {
  id: string;
  codeRunId: string;
  stage: CodingStage;
  attempt: number;
  status: CodeStageStatus;
  agentId: string | null;
  threadId: string | null;
  lastRunId: string | null;
  autoRetries: number;
  step: string;
  verdict: string | null;
  summary: string | null;
  questions: string[];
  input: Record<string, unknown>;
  superseded: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CodeRunArtifact = {
  id: string;
  codeRunId: string;
  stage: CodingStage;
  attempt: number;
  name: string;
  content: string;
  createdAt: string;
};

export type CodeFeedbackStatus =
  | "new"
  | "triaged"
  | "dismissed"
  | "no_action"
  | "fixed"
  | "replied"
  | "resolved";

export type CodeFeedbackItem = {
  id: string;
  codeRunId: string;
  githubId: string;
  kind: "review_comment" | "review" | "issue_comment";
  author: string;
  authorIsBot: boolean;
  path: string | null;
  line: number | null;
  body: string;
  url: string | null;
  reviewCommentId: number | null;
  githubUpdatedAt: string;
  status: CodeFeedbackStatus;
  action: "fix" | "reply" | "no_action" | null;
  reason: string | null;
  reply: string | null;
  roundStageId: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StageUsage = {
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  durationMs: number | null;
  model: string | null;
  runs: number;
};

export type CodeRunSummary = CodeRun & {
  repository: Pick<CodeRepository, "id" | "owner" | "name" | "fullName">;
  stages: Array<
    Pick<CodeRunStage, "id" | "stage" | "status" | "attempt"> & StageUsage
  >;
  costUsd: number | null;
};
