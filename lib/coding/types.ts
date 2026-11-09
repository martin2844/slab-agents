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

export type WorkspaceStatus = "pending" | "preparing" | "ready" | "failed" | "deleted";
export type PullRequestStatus = "draft" | "open" | "merged" | "closed";
export type CiStatus = "pending" | "success" | "failure" | "none";

/** One repository of a coding run: its own workspace, branch base, and pull request. */
export type CodeRunRepository = {
  id: string;
  codeRunId: string;
  repositoryId: string;
  /** 0 is the primary repository: its workspace holds the handoff folder. */
  position: number;
  owner: string;
  name: string;
  fullName: string;
  workspaceId: string;
  workspaceStatus: WorkspaceStatus;
  baseSha: string | null;
  headSha: string | null;
  prNumber: number | null;
  prUrl: string | null;
  prState: PullRequestStatus | null;
  ciState: CiStatus | null;
  prCheckedAt: string | null;
  lastPublishedSha: string | null;
  publishedAt: string | null;
  error: string | null;
};

export type CodeRun = {
  id: string;
  number: number;
  issueKey: string;
  title: string;
  /** Primary repository. */
  repositoryId: string;
  status: CodeRunStatus;
  currentStage: CodingStage;
  /** Primary workspace: the agent's working directory and the handoff folder. */
  workspaceId: string;
  /** All workspaces of the run: ready only when every repository is ready. */
  workspaceStatus: WorkspaceStatus;
  branch: string;
  note: string;
  repositories: CodeRunRepository[];
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
  runRepositoryId: string | null;
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
  stages: Array<
    Pick<CodeRunStage, "id" | "stage" | "status" | "attempt"> & StageUsage
  >;
  costUsd: number | null;
};
