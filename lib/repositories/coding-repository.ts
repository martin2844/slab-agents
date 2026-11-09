import "server-only";

import { randomUUID } from "node:crypto";
import { db, now } from "@/lib/db/database";
import { json, type Row } from "@/lib/repositories/repository-helpers";
import type {
  CodeRunStatus,
  CodeStageStatus,
  CodingStage,
} from "@/lib/coding/stages";
import type {
  CodeFeedbackItem,
  CodeFeedbackStatus,
  CodeRepository,
  CodeRun,
  CodeRunArtifact,
  CodeRunRepository,
  CodeRunStage,
  StageUsage,
} from "@/lib/coding/types";

const text = (value: unknown) => (value == null ? null : String(value));
const integer = (value: unknown) =>
  value == null || value === "" ? null : Number(value);

function mapRepository(row: Row): CodeRepository {
  return {
    id: String(row.id),
    sourceAppId: String(row.source_app_id),
    owner: String(row.owner),
    name: String(row.name),
    fullName: `${String(row.owner)}/${String(row.name)}`,
    defaultBranch: String(row.default_branch),
    setupCommand: text(row.setup_command),
    testCommand: text(row.test_command),
    lintCommand: text(row.lint_command),
    typecheckCommand: text(row.typecheck_command),
    setupNotes: String(row.setup_notes ?? ""),
    workProjectKey: text(row.work_project_key),
    enabled: Boolean(row.enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapRunRepository(row: Row): CodeRunRepository {
  const owner = String(row.owner ?? "?");
  const name = String(row.name ?? "?");
  return {
    id: String(row.id),
    codeRunId: String(row.code_run_id),
    repositoryId: String(row.repository_id),
    position: Number(row.position),
    owner,
    name,
    fullName: row.owner == null ? "(deleted repository)" : `${owner}/${name}`,
    workspaceId: String(row.workspace_id),
    workspaceStatus: String(row.workspace_status ?? "pending") as CodeRunRepository["workspaceStatus"],
    baseSha: text(row.base_sha),
    headSha: text(row.head_sha),
    prNumber: integer(row.pr_number),
    prUrl: text(row.pr_url),
    prState: text(row.pr_state) as CodeRunRepository["prState"],
    ciState: text(row.ci_state) as CodeRunRepository["ciState"],
    prCheckedAt: text(row.pr_checked_at),
    lastPublishedSha: text(row.last_published_sha),
    publishedAt: text(row.published_at),
    error: text(row.error),
  };
}

const RUN_REPOSITORY_SELECT =
  "SELECT rr.*, r.owner AS owner, r.name AS name FROM code_run_repositories rr LEFT JOIN code_repositories r ON r.id = rr.repository_id";

function listRunRepositories(codeRunId: string) {
  return (
    db
      .prepare(`${RUN_REPOSITORY_SELECT} WHERE rr.code_run_id=? ORDER BY rr.position`)
      .all(codeRunId) as Row[]
  ).map(mapRunRepository);
}

function mapRun(row: Row): CodeRun {
  return {
    id: String(row.id),
    number: Number(row.number),
    issueKey: String(row.issue_key),
    title: String(row.title),
    repositoryId: String(row.repository_id),
    status: row.status as CodeRunStatus,
    currentStage: row.current_stage as CodingStage,
    workspaceId: String(row.workspace_id),
    workspaceStatus: String(
      row.workspace_status ?? "pending",
    ) as CodeRun["workspaceStatus"],
    branch: String(row.branch),
    note: String(row.note ?? ""),
    repositories: listRunRepositories(String(row.id)),
    error: text(row.error),
    startedAt: String(row.started_at),
    finishedAt: text(row.finished_at),
    updatedAt: String(row.updated_at),
  };
}

function mapStage(row: Row): CodeRunStage {
  return {
    id: String(row.id),
    codeRunId: String(row.code_run_id),
    stage: row.stage as CodingStage,
    attempt: Number(row.attempt),
    status: row.status as CodeStageStatus,
    agentId: text(row.agent_id),
    threadId: text(row.thread_id),
    lastRunId: text(row.last_run_id),
    autoRetries: Number(row.auto_retries ?? 0),
    step: String(row.step ?? ""),
    verdict: text(row.verdict),
    summary: text(row.summary),
    questions: json<string[]>(row.questions_json, []),
    input: json<Record<string, unknown>>(row.input_json, {}),
    superseded: Boolean(row.superseded),
    startedAt: text(row.started_at),
    finishedAt: text(row.finished_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapArtifact(row: Row): CodeRunArtifact {
  return {
    id: String(row.id),
    codeRunId: String(row.code_run_id),
    stage: row.stage as CodingStage,
    attempt: Number(row.attempt),
    name: String(row.name),
    content: String(row.content),
    createdAt: String(row.created_at),
  };
}

function mapFeedback(row: Row): CodeFeedbackItem {
  return {
    id: String(row.id),
    codeRunId: String(row.code_run_id),
    runRepositoryId: text(row.run_repository_id),
    githubId: String(row.github_id),
    kind: row.kind as CodeFeedbackItem["kind"],
    author: String(row.author),
    authorIsBot: Boolean(row.author_is_bot),
    path: text(row.path),
    line: integer(row.line),
    body: String(row.body),
    url: text(row.url),
    reviewCommentId: integer(row.review_comment_id),
    githubUpdatedAt: String(row.github_updated_at),
    status: row.status as CodeFeedbackStatus,
    action: text(row.action) as CodeFeedbackItem["action"],
    reason: text(row.reason),
    reply: text(row.reply),
    roundStageId: text(row.round_stage_id),
    decidedAt: text(row.decided_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export type RepositoryInput = {
  sourceAppId: string;
  owner: string;
  name: string;
  defaultBranch: string;
  setupCommand: string | null;
  testCommand: string | null;
  lintCommand: string | null;
  typecheckCommand: string | null;
  setupNotes: string;
  workProjectKey: string | null;
  enabled: boolean;
};

const RUN_COLUMNS: Record<string, string> = {
  status: "status",
  currentStage: "current_stage",
  workspaceStatus: "workspace_status",
  error: "error",
  finishedAt: "finished_at",
  title: "title",
};

const RUN_REPOSITORY_COLUMNS: Record<string, string> = {
  workspaceStatus: "workspace_status",
  baseSha: "base_sha",
  headSha: "head_sha",
  prNumber: "pr_number",
  prUrl: "pr_url",
  prState: "pr_state",
  ciState: "ci_state",
  prCheckedAt: "pr_checked_at",
  lastPublishedSha: "last_published_sha",
  publishedAt: "published_at",
  error: "error",
};

const STAGE_COLUMNS: Record<string, string> = {
  status: "status",
  agentId: "agent_id",
  threadId: "thread_id",
  lastRunId: "last_run_id",
  autoRetries: "auto_retries",
  step: "step",
  verdict: "verdict",
  summary: "summary",
  superseded: "superseded",
  startedAt: "started_at",
  finishedAt: "finished_at",
};

function updateColumns(
  table: string,
  columns: Record<string, string>,
  id: string,
  patch: Record<string, unknown>,
) {
  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key === "questions") {
      assignments.push("questions_json=?");
      values.push(JSON.stringify(value));
      continue;
    }
    if (key === "input") {
      assignments.push("input_json=?");
      values.push(JSON.stringify(value));
      continue;
    }
    const column = columns[key];
    if (!column) throw new Error(`Unknown ${table} field ${key}.`);
    assignments.push(`${column}=?`);
    values.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
  }
  assignments.push("updated_at=?");
  values.push(now());
  db.prepare(`UPDATE ${table} SET ${assignments.join(",")} WHERE id=?`).run(
    ...values,
    id,
  );
}

export const codingRepository = {
  // Repositories
  listRepositories() {
    return (
      db
        .prepare("SELECT * FROM code_repositories ORDER BY owner, name")
        .all() as Row[]
    ).map(mapRepository);
  },
  getRepository(id: string) {
    const row = db
      .prepare("SELECT * FROM code_repositories WHERE id=?")
      .get(id) as Row | undefined;
    return row ? mapRepository(row) : null;
  },
  createRepository(input: RepositoryInput) {
    const id = randomUUID();
    const timestamp = now();
    db.prepare(
      `INSERT INTO code_repositories (id,source_app_id,owner,name,default_branch,setup_command,test_command,lint_command,typecheck_command,setup_notes,work_project_key,enabled,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      input.sourceAppId,
      input.owner,
      input.name,
      input.defaultBranch,
      input.setupCommand,
      input.testCommand,
      input.lintCommand,
      input.typecheckCommand,
      input.setupNotes,
      input.workProjectKey,
      input.enabled ? 1 : 0,
      timestamp,
      timestamp,
    );
    return codingRepository.getRepository(id)!;
  },
  updateRepository(id: string, input: RepositoryInput) {
    db.prepare(
      `UPDATE code_repositories SET source_app_id=?,owner=?,name=?,default_branch=?,setup_command=?,test_command=?,lint_command=?,typecheck_command=?,setup_notes=?,work_project_key=?,enabled=?,updated_at=? WHERE id=?`,
    ).run(
      input.sourceAppId,
      input.owner,
      input.name,
      input.defaultBranch,
      input.setupCommand,
      input.testCommand,
      input.lintCommand,
      input.typecheckCommand,
      input.setupNotes,
      input.workProjectKey,
      input.enabled ? 1 : 0,
      now(),
      id,
    );
    return codingRepository.getRepository(id);
  },
  setRepositorySetupNotes(id: string, notes: string) {
    db.prepare(
      "UPDATE code_repositories SET setup_notes=?, updated_at=? WHERE id=?",
    ).run(notes, now(), id);
  },
  deleteRepository(id: string) {
    const used = db
      .prepare(
        "SELECT 1 FROM code_runs WHERE repository_id=? UNION ALL SELECT 1 FROM code_run_repositories WHERE repository_id=? LIMIT 1",
      )
      .get(id, id);
    if (used) return false;
    return (
      db.prepare("DELETE FROM code_repositories WHERE id=?").run(id).changes ===
      1
    );
  },

  // Runs
  /** Creates a run on one or more repositories; the first one is the primary repository. */
  createRun(input: {
    issueKey: string;
    title: string;
    repositoryIds: string[];
    note: string;
  }) {
    if (!input.repositoryIds.length) throw new Error("A coding run needs a repository.");
    const id = randomUUID();
    const timestamp = now();
    const next =
      Number(
        (
          db
            .prepare("SELECT COALESCE(MAX(number),0) AS value FROM code_runs")
            .get() as Row
        ).value,
      ) + 1;
    const slug = input.issueKey.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    const workspaceId = `code-run-${next}-${id.slice(0, 8)}`;
    db.prepare(
      `INSERT INTO code_runs (id,number,issue_key,title,repository_id,status,current_stage,workspace_id,workspace_status,branch,note,started_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      next,
      input.issueKey,
      input.title,
      input.repositoryIds[0],
      "preparing",
      "pm",
      workspaceId,
      "pending",
      `slab/${slug}-${next}`,
      input.note,
      timestamp,
      timestamp,
    );
    const insert = db.prepare(
      `INSERT INTO code_run_repositories (id,code_run_id,repository_id,position,workspace_id,workspace_status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    );
    input.repositoryIds.forEach((repositoryId, position) => {
      insert.run(
        `${id}:${position}`,
        id,
        repositoryId,
        position,
        position === 0 ? workspaceId : `${workspaceId}-r${position}`,
        "pending",
        timestamp,
        timestamp,
      );
    });
    return codingRepository.getRun(id)!;
  },
  getRun(id: string) {
    const row = db
      .prepare("SELECT * FROM code_runs WHERE id=? OR CAST(number AS TEXT)=?")
      .get(id, id) as Row | undefined;
    return row ? mapRun(row) : null;
  },
  listRuns(limit = 100) {
    return (
      db
        .prepare("SELECT * FROM code_runs ORDER BY number DESC LIMIT ?")
        .all(limit) as Row[]
    ).map(mapRun);
  },
  listRunsForIssue(issueKey: string) {
    return (
      db
        .prepare(
          "SELECT * FROM code_runs WHERE issue_key=? ORDER BY number DESC",
        )
        .all(issueKey) as Row[]
    ).map(mapRun);
  },
  listOpenRuns() {
    return (
      db
        .prepare(
          "SELECT * FROM code_runs WHERE status IN ('preparing','active','waiting') ORDER BY number",
        )
        .all() as Row[]
    ).map(mapRun);
  },
  /** Run repositories with a pull request that is still open (runs not cancelled). */
  listOpenPullRequests() {
    return (
      db
        .prepare(
          `${RUN_REPOSITORY_SELECT} JOIN code_runs c ON c.id = rr.code_run_id WHERE rr.pr_number IS NOT NULL AND (rr.pr_state IS NULL OR rr.pr_state IN ('draft','open')) AND c.status != 'cancelled' ORDER BY c.number, rr.position`,
        )
        .all() as Row[]
    ).map(mapRunRepository);
  },
  listRunRepositories,
  getRunRepository(id: string) {
    const row = db
      .prepare(`${RUN_REPOSITORY_SELECT} WHERE rr.id=?`)
      .get(id) as Row | undefined;
    return row ? mapRunRepository(row) : null;
  },
  updateRunRepository(id: string, patch: Partial<CodeRunRepository>) {
    updateColumns("code_run_repositories", RUN_REPOSITORY_COLUMNS, id, patch);
    return codingRepository.getRunRepository(id)!;
  },
  /** Open runs that change this repository. */
  listOpenRunsForRepository(repositoryId: string) {
    return codingRepository
      .listOpenRuns()
      .filter((run) => run.repositories.some((item) => item.repositoryId === repositoryId));
  },
  listRunsWithQueuedSideStages() {
    return (
      db
        .prepare(
          "SELECT DISTINCT r.* FROM code_runs r JOIN code_run_stages s ON s.code_run_id=r.id WHERE r.status IN ('done','failed') AND s.superseded=0 AND s.status='queued' AND s.stage IN ('chat','pr_feedback')",
        )
        .all() as Row[]
    ).map(mapRun);
  },
  countWaitingRuns() {
    return Number(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS value FROM code_runs WHERE status='waiting'",
          )
          .get() as Row
      ).value,
    );
  },
  updateRun(id: string, patch: Partial<CodeRun>) {
    updateColumns("code_runs", RUN_COLUMNS, id, patch);
    return codingRepository.getRun(id)!;
  },

  // Stages
  createStage(input: {
    codeRunId: string;
    stage: CodingStage;
    status?: CodeStageStatus;
    agentId?: string | null;
    input?: Record<string, unknown>;
  }) {
    const id = randomUUID();
    const timestamp = now();
    const attempt =
      Number(
        (
          db
            .prepare(
              "SELECT COALESCE(MAX(attempt),0) AS value FROM code_run_stages WHERE code_run_id=? AND stage=?",
            )
            .get(input.codeRunId, input.stage) as Row
        ).value,
      ) + 1;
    db.prepare(
      `INSERT INTO code_run_stages (id,code_run_id,stage,attempt,status,agent_id,input_json,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      input.codeRunId,
      input.stage,
      attempt,
      input.status ?? "queued",
      input.agentId ?? null,
      JSON.stringify(input.input ?? {}),
      timestamp,
      timestamp,
    );
    return codingRepository.getStage(id)!;
  },
  getStage(id: string) {
    const row = db
      .prepare("SELECT * FROM code_run_stages WHERE id=?")
      .get(id) as Row | undefined;
    return row ? mapStage(row) : null;
  },
  listStages(codeRunId: string) {
    return (
      db
        .prepare(
          "SELECT * FROM code_run_stages WHERE code_run_id=? ORDER BY created_at, rowid",
        )
        .all(codeRunId) as Row[]
    ).map(mapStage);
  },
  /** The current (latest, not superseded) attempt of one stage. */
  currentStage(codeRunId: string, stage: CodingStage) {
    const row = db
      .prepare(
        "SELECT * FROM code_run_stages WHERE code_run_id=? AND stage=? AND superseded=0 ORDER BY attempt DESC LIMIT 1",
      )
      .get(codeRunId, stage) as Row | undefined;
    return row ? mapStage(row) : null;
  },
  activeStages() {
    return (
      db
        .prepare(
          "SELECT * FROM code_run_stages WHERE status IN ('queued','running') AND superseded=0 ORDER BY created_at",
        )
        .all() as Row[]
    ).map(mapStage);
  },
  updateStage(id: string, patch: Partial<CodeRunStage>) {
    updateColumns("code_run_stages", STAGE_COLUMNS, id, patch);
    return codingRepository.getStage(id)!;
  },
  supersedeStages(codeRunId: string, stages: CodingStage[]) {
    if (!stages.length) return;
    db.prepare(
      `UPDATE code_run_stages SET superseded=1, updated_at=? WHERE code_run_id=? AND stage IN (${stages.map(() => "?").join(",")})`,
    ).run(now(), codeRunId, ...stages);
  },
  stageForRun(runId: string) {
    const row = db
      .prepare(
        "SELECT s.* FROM code_run_stages s JOIN runs r ON r.code_run_stage_id = s.id WHERE r.id=? OR r.runner_run_id=? LIMIT 1",
      )
      .get(runId, runId) as Row | undefined;
    return row ? mapStage(row) : null;
  },
  linkRunToStage(runId: string, stageId: string) {
    db.prepare("UPDATE runs SET code_run_stage_id=? WHERE id=?").run(
      stageId,
      runId,
    );
  },
  stageUsage(stageIds: string[]): Map<string, StageUsage> {
    const result = new Map<string, StageUsage>();
    if (!stageIds.length) return result;
    const rows = db
      .prepare(
        `SELECT r.code_run_stage_id AS stage_id,
                COUNT(DISTINCT r.id) AS runs,
                MAX(r.model) AS model,
                SUM(CASE WHEN r.started_at IS NOT NULL THEN
                  (julianday(COALESCE(r.completed_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))) - julianday(r.started_at)) * 86400000
                  ELSE 0 END) AS duration_ms,
                COALESCE(SUM(b.actual_input_tokens),0) AS input_tokens,
                COALESCE(SUM(b.actual_output_tokens),0) AS output_tokens,
                SUM(CASE WHEN b.actual_cost_source IN ('provider_reported','sdk_estimated','pricing_snapshot') THEN b.actual_cost_micro_usd ELSE NULL END) AS cost_micro
         FROM runs r
         LEFT JOIN run_budget_reservations b ON b.run_id = r.id
         WHERE r.code_run_stage_id IN (${stageIds.map(() => "?").join(",")})
         GROUP BY r.code_run_stage_id`,
      )
      .all(...stageIds) as Row[];
    for (const row of rows) {
      result.set(String(row.stage_id), {
        runs: Number(row.runs ?? 0),
        model: text(row.model),
        durationMs:
          row.duration_ms == null ? null : Math.round(Number(row.duration_ms)),
        inputTokens: Number(row.input_tokens ?? 0),
        outputTokens: Number(row.output_tokens ?? 0),
        costUsd: row.cost_micro == null ? null : Number(row.cost_micro) / 1e6,
      });
    }
    return result;
  },

  // Artifacts
  saveArtifact(input: {
    codeRunId: string;
    stage: CodingStage;
    attempt: number;
    name: string;
    content: string;
  }) {
    const latest = db
      .prepare(
        "SELECT content FROM code_run_artifacts WHERE code_run_id=? AND name=? AND stage=? AND attempt=? ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get(input.codeRunId, input.name, input.stage, input.attempt) as
      | Row
      | undefined;
    if (latest && String(latest.content) === input.content) return;
    db.prepare(
      "INSERT INTO code_run_artifacts (id,code_run_id,stage,attempt,name,content,created_at) VALUES (?,?,?,?,?,?,?)",
    ).run(
      randomUUID(),
      input.codeRunId,
      input.stage,
      input.attempt,
      input.name,
      input.content,
      now(),
    );
  },
  listArtifacts(codeRunId: string) {
    return (
      db
        .prepare(
          "SELECT * FROM code_run_artifacts WHERE code_run_id=? ORDER BY created_at, rowid",
        )
        .all(codeRunId) as Row[]
    ).map(mapArtifact);
  },
  latestArtifact(codeRunId: string, name: string) {
    const row = db
      .prepare(
        "SELECT * FROM code_run_artifacts WHERE code_run_id=? AND name=? ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get(codeRunId, name) as Row | undefined;
    return row ? mapArtifact(row) : null;
  },

  // PR feedback ledger
  listFeedback(codeRunId: string) {
    return (
      db
        .prepare(
          "SELECT * FROM code_feedback_items WHERE code_run_id=? ORDER BY github_updated_at, rowid",
        )
        .all(codeRunId) as Row[]
    ).map(mapFeedback);
  },
  getFeedback(id: string) {
    const row = db
      .prepare("SELECT * FROM code_feedback_items WHERE id=?")
      .get(id) as Row | undefined;
    return row ? mapFeedback(row) : null;
  },
  upsertFeedback(input: {
    codeRunId: string;
    runRepositoryId: string;
    githubId: string;
    kind: CodeFeedbackItem["kind"];
    author: string;
    authorIsBot: boolean;
    path: string | null;
    line: number | null;
    body: string;
    url: string | null;
    reviewCommentId: number | null;
    githubUpdatedAt: string;
    initialStatus: CodeFeedbackStatus;
  }) {
    const existing = db
      .prepare(
        "SELECT * FROM code_feedback_items WHERE code_run_id=? AND github_id=?",
      )
      .get(input.codeRunId, `${input.githubId}`) as Row | undefined;
    const timestamp = now();
    if (!existing) {
      db.prepare(
        `INSERT INTO code_feedback_items (id,code_run_id,run_repository_id,github_id,kind,author,author_is_bot,path,line,body,url,review_comment_id,github_updated_at,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        randomUUID(),
        input.codeRunId,
        input.runRepositoryId,
        input.githubId,
        input.kind,
        input.author,
        input.authorIsBot ? 1 : 0,
        input.path,
        input.line,
        input.body,
        input.url,
        input.reviewCommentId,
        input.githubUpdatedAt,
        input.initialStatus,
        timestamp,
        timestamp,
      );
      return "created" as const;
    }
    const current = mapFeedback(existing);
    if (current.githubUpdatedAt === input.githubUpdatedAt) return "unchanged";
    // New activity reopens a decided item (untrusted authors and bot summaries stay dismissed).
    db.prepare(
      "UPDATE code_feedback_items SET body=?, github_updated_at=?, status=?, action=NULL, reason=NULL, reply=NULL, decided_at=NULL, updated_at=? WHERE id=?",
    ).run(input.body, input.githubUpdatedAt, input.initialStatus, timestamp, current.id);
    return "reopened" as const;
  },
  updateFeedback(
    id: string,
    patch: Partial<
      Pick<
        CodeFeedbackItem,
        "status" | "action" | "reason" | "reply" | "roundStageId" | "decidedAt"
      >
    >,
  ) {
    const columns: Record<string, string> = {
      status: "status",
      action: "action",
      reason: "reason",
      reply: "reply",
      roundStageId: "round_stage_id",
      decidedAt: "decided_at",
    };
    updateColumns("code_feedback_items", columns, id, patch);
    return codingRepository.getFeedback(id)!;
  },
};
