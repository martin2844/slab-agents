import "server-only";

import { OperationalError } from "@/lib/operational-error";
import { readSecret } from "@/lib/server-config";

/** Client for slab-runner started with RUNNER_PROFILE=code. See slab-runner/docs/plans/code-runner-contract.md. */

export function codeRunnerUrl() {
  return (process.env.CODE_RUNNER_URL ?? "http://127.0.0.1:6991").replace(
    /\/$/,
    "",
  );
}

export function codeRunnerHeaders(headers: Record<string, string> = {}) {
  const token = readSecret("CODE_RUNNER_TOKEN", "CODE_RUNNER_TOKEN_FILE");
  return {
    ...headers,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export type CodeWorkspace = {
  id: string;
  status: "preparing" | "ready" | "busy" | "failed";
  repository: { cloneUrl: string; defaultBranch: string };
  branch: string;
  baseSha: string | null;
  headSha: string | null;
  repoPath: string;
  handoffPath: string;
  setup: {
    status: "skipped" | "running" | "passed" | "failed";
    exitCode: number | null;
    logTail: string;
  } | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CodeDiff = {
  baseSha: string;
  headSha: string;
  files: Array<{
    path: string;
    status: string;
    insertions: number;
    deletions: number;
  }>;
  insertions: number;
  deletions: number;
  uncommitted: boolean;
  commits: Array<{ sha: string; subject: string }>;
  patch: string;
  truncated: boolean;
};

export type PublishResult = {
  branch: string;
  headSha: string;
  baseSha: string;
  commits: number;
  insertions: number;
  deletions: number;
  files: number;
};

export class CodeRunnerError extends OperationalError {
  readonly remoteCode: string;
  readonly details: unknown;
  constructor(message: string, remoteCode: string, status: number, details: unknown = null) {
    super(message, remoteCode || "CODE_RUNNER_ERROR", status >= 400 && status < 600 ? status : 502);
    this.remoteCode = remoteCode;
    this.details = details;
  }
}

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${codeRunnerUrl()}${path}`, {
      method: init.method ?? "GET",
      headers: codeRunnerHeaders({
        Accept: "application/json",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      }),
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      cache: "no-store",
      signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
    });
  } catch {
    throw new CodeRunnerError(
      "The code runner could not be reached. Check CODE_RUNNER_URL and that slab-runner-code is running.",
      "CODE_RUNNER_UNAVAILABLE",
      503,
    );
  }
  const payload = (await response.json().catch(() => null)) as
    | { data?: T; error?: { code?: string; message?: string; details?: unknown } }
    | null;
  if (!response.ok) {
    throw new CodeRunnerError(
      payload?.error?.message ?? `The code runner returned HTTP ${response.status}.`,
      payload?.error?.code ?? "CODE_RUNNER_ERROR",
      response.status,
      payload?.error?.details ?? null,
    );
  }
  return (payload?.data ?? payload) as T;
}

export const codeRunner = {
  health: () =>
    request<{ status: string; profile?: string }>("/health", { timeoutMs: 5_000 }),
  createWorkspace: (input: {
    workspaceId: string;
    repository: { cloneUrl: string; defaultBranch: string };
    baseRef: string;
    branch: string;
    fetchToken: string | null;
    setupCommand: string | null;
    setupTimeoutSeconds?: number;
    gitIdentity: { name: string; email: string };
  }) => request<CodeWorkspace>("/workspaces", { method: "POST", body: input, timeoutMs: 30_000 }),
  getWorkspace: (id: string) =>
    request<CodeWorkspace>(`/workspaces/${encodeURIComponent(id)}`),
  deleteWorkspace: (id: string) =>
    request<{ id: string; deleted: boolean }>(`/workspaces/${encodeURIComponent(id)}`, {
      method: "DELETE",
      timeoutMs: 60_000,
    }),
  listHandoff: (id: string) =>
    request<Array<{ name: string; size: number; updatedAt: string }>>(
      `/workspaces/${encodeURIComponent(id)}/handoff`,
    ),
  readHandoff: async (id: string, name: string) => {
    try {
      return await request<{ name: string; content: string; updatedAt: string }>(
        `/workspaces/${encodeURIComponent(id)}/handoff/${encodeURIComponent(name)}`,
      );
    } catch (error) {
      if (error instanceof CodeRunnerError && error.status === 404) return null;
      throw error;
    }
  },
  writeHandoff: (id: string, name: string, content: string) =>
    request<{ name: string; size: number; updatedAt: string }>(
      `/workspaces/${encodeURIComponent(id)}/handoff/${encodeURIComponent(name)}`,
      { method: "PUT", body: { content } },
    ),
  diff: (id: string) =>
    request<CodeDiff>(`/workspaces/${encodeURIComponent(id)}/diff`, { timeoutMs: 60_000 }),
  publish: (
    id: string,
    input: {
      pushToken: string;
      remoteUrl: string;
      /** Authoritative branch and base; the runner rejects a workspace whose record differs. */
      branch: string;
      baseSha: string;
      commitMessage: string;
      forbiddenPaths?: string[];
    },
  ) =>
    request<PublishResult>(`/workspaces/${encodeURIComponent(id)}/publish`, {
      method: "POST",
      body: input,
      timeoutMs: 180_000,
    }),
};
