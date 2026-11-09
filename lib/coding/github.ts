import "server-only";

import { OperationalError } from "@/lib/operational-error";
import { githubInstallationToken } from "@/lib/sources/github-app";
import type { CodeRepository } from "@/lib/coding/types";

const GITHUB_API = "https://api.github.com";

export function repositoryCloneUrl(repository: Pick<CodeRepository, "owner" | "name">) {
  return `https://github.com/${repository.owner}/${repository.name}.git`;
}

/**
 * Installation token limited to this one repository.
 * - "fetch" / "push": handed to the code runner for one clone or push; contents only.
 * - "api": stays in the control plane for pull requests, comments and CI state.
 */
export function installationToken(
  repository: Pick<CodeRepository, "sourceAppId" | "name">,
  purpose: "fetch" | "push" | "api" = "api",
) {
  return githubInstallationToken(repository.sourceAppId, {
    repositories: [repository.name],
    ...(purpose === "api"
      ? {}
      : { permissions: { contents: purpose === "push" ? "write" : "read", metadata: "read" } }),
  });
}

async function githubRequest<T>(
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(new URL(path, GITHUB_API), {
      method: init.method ?? "GET",
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "Slab-Coding/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch {
    throw new OperationalError(
      controller.signal.aborted
        ? "GitHub did not respond before the timeout."
        : "GitHub could not be reached.",
      "GITHUB_UNAVAILABLE",
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => null)) as
    | (T & { message?: string; errors?: Array<{ message?: string }> })
    | null;
  if (!response.ok) {
    const detail =
      payload?.errors?.map((error) => error.message).filter(Boolean).join("; ") ||
      payload?.message ||
      `HTTP ${response.status}`;
    throw new OperationalError(
      `GitHub rejected the request: ${detail}`,
      response.status === 401 || response.status === 403
        ? "GITHUB_AUTH_FAILED"
        : response.status === 404
          ? "GITHUB_NOT_FOUND"
          : "GITHUB_API_ERROR",
      response.status === 404 ? 404 : 502,
    );
  }
  return payload as T;
}

type GitHubPull = {
  number: number;
  html_url: string;
  state: "open" | "closed";
  draft?: boolean;
  merged?: boolean;
  merged_at?: string | null;
  head: { sha: string; ref: string };
  base: { ref: string };
  additions?: number;
  deletions?: number;
  changed_files?: number;
  title: string;
};

export type PullRequestState = {
  number: number;
  url: string;
  state: "draft" | "open" | "merged" | "closed";
  headSha: string;
  title: string;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
};

function mapPull(pull: GitHubPull): PullRequestState {
  return {
    number: pull.number,
    url: pull.html_url,
    state: pull.merged || pull.merged_at
      ? "merged"
      : pull.state === "closed"
        ? "closed"
        : pull.draft
          ? "draft"
          : "open",
    headSha: pull.head.sha,
    title: pull.title,
    additions: pull.additions ?? null,
    deletions: pull.deletions ?? null,
    changedFiles: pull.changed_files ?? null,
  };
}

/** Every page of a list endpoint (100 per page, at most 10 pages). */
async function githubList<T>(token: string, path: string): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const batch = await githubRequest<T[]>(token, `${path}${separator}per_page=100&page=${page}`);
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  return rows;
}

const repoPath = (repository: Pick<CodeRepository, "owner" | "name">) =>
  `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;

export async function findOpenPullRequest(
  repository: CodeRepository,
  branch: string,
  token?: string,
) {
  const accessToken = token ?? (await installationToken(repository));
  const pulls = await githubRequest<GitHubPull[]>(
    accessToken,
    `${repoPath(repository)}/pulls?state=open&head=${encodeURIComponent(`${repository.owner}:${branch}`)}`,
  );
  return pulls[0] ? mapPull(pulls[0]) : null;
}

export async function createDraftPullRequest(
  repository: CodeRepository,
  input: { title: string; branch: string; body: string },
  token?: string,
) {
  const accessToken = token ?? (await installationToken(repository));
  const existing = await findOpenPullRequest(repository, input.branch, accessToken);
  if (existing) return existing;
  const pull = await githubRequest<GitHubPull>(accessToken, `${repoPath(repository)}/pulls`, {
    method: "POST",
    body: {
      title: input.title,
      head: input.branch,
      base: repository.defaultBranch,
      body: input.body,
      draft: true,
      maintainer_can_modify: true,
    },
  });
  return mapPull(pull);
}

export async function updatePullRequest(
  repository: CodeRepository,
  number: number,
  input: { title?: string; body?: string },
) {
  const token = await installationToken(repository);
  const pull = await githubRequest<GitHubPull>(
    token,
    `${repoPath(repository)}/pulls/${number}`,
    { method: "PATCH", body: input },
  );
  return mapPull(pull);
}

export async function getPullRequest(repository: CodeRepository, number: number) {
  const token = await installationToken(repository);
  const pull = await githubRequest<GitHubPull>(
    token,
    `${repoPath(repository)}/pulls/${number}`,
  );
  return { pull: mapPull(pull), token };
}

export type CiState = "pending" | "success" | "failure" | "none";

export function combineCiState(input: {
  checkRuns: Array<{ status: string; conclusion: string | null }>;
  statuses: Array<{ state: string }>;
}): CiState {
  const states: Array<"pending" | "success" | "failure"> = [];
  for (const run of input.checkRuns) {
    if (run.status !== "completed") states.push("pending");
    else if (
      ["success", "neutral", "skipped"].includes(run.conclusion ?? "")
    )
      states.push("success");
    else states.push("failure");
  }
  for (const status of input.statuses) {
    if (status.state === "pending") states.push("pending");
    else if (status.state === "success") states.push("success");
    else states.push("failure");
  }
  if (!states.length) return "none";
  if (states.includes("failure")) return "failure";
  if (states.includes("pending")) return "pending";
  return "success";
}

export async function getCiState(
  repository: CodeRepository,
  sha: string,
  token: string,
): Promise<{ state: CiState; failing: string[]; total: number }> {
type CheckRun = { name: string; status: string; conclusion: string | null };
  const listChecks = async () => {
    const rows: CheckRun[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const batch = await githubRequest<{ check_runs?: CheckRun[] }>(
        token,
        `${repoPath(repository)}/commits/${sha}/check-runs?per_page=100&page=${page}`,
      );
      rows.push(...(batch.check_runs ?? []));
      if ((batch.check_runs ?? []).length < 100) break;
    }
    return rows;
  };
  const [checkRuns, combined] = await Promise.all([
    listChecks(),
    githubRequest<{ statuses: Array<{ context: string; state: string }> }>(
      token,
      `${repoPath(repository)}/commits/${sha}/status?per_page=100`,
    ),
  ]);
  const statuses = combined.statuses ?? [];
  return {
    state: combineCiState({ checkRuns, statuses }),
    total: checkRuns.length + statuses.length,
    failing: [
      ...checkRuns
        .filter(
          (run) =>
            run.status === "completed" &&
            !["success", "neutral", "skipped"].includes(run.conclusion ?? ""),
        )
        .map((run) => run.name),
      ...statuses
        .filter((status) => !["pending", "success"].includes(status.state))
        .map((status) => status.context),
    ],
  };
}

export type RemoteFeedback = {
  githubId: string;
  kind: "review_comment" | "review" | "issue_comment";
  author: string;
  authorIsBot: boolean;
  path: string | null;
  line: number | null;
  body: string;
  url: string | null;
  reviewCommentId: number | null;
  updatedAt: string;
  inReplyTo: number | null;
  /** Owner, member or collaborator of the repository (or a bot installed on it). */
  trusted: boolean;
};

const TRUSTED_ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR"];
const isTrusted = (user: GitHubUser, association: string | undefined) =>
  isBot(user) || TRUSTED_ASSOCIATIONS.includes(association ?? "");

type GitHubUser = { login: string; type?: string } | null;

const isBot = (user: GitHubUser) =>
  Boolean(user && (user.type === "Bot" || /\[bot\]$/.test(user.login)));

export async function listPullRequestFeedback(
  repository: CodeRepository,
  number: number,
): Promise<RemoteFeedback[]> {
  const token = await installationToken(repository);
  const base = repoPath(repository);
  const [reviewComments, reviews, issueComments] = await Promise.all([
    githubList<{
      id: number;
      user: GitHubUser;
      author_association?: string;
      path: string | null;
      line: number | null;
      original_line?: number | null;
      body: string;
      html_url: string;
      updated_at: string;
      in_reply_to_id?: number;
    }>(token, `${base}/pulls/${number}/comments`),
    githubList<{
      id: number;
      user: GitHubUser;
      author_association?: string;
      body: string | null;
      state: string;
      html_url: string;
      submitted_at: string | null;
    }>(token, `${base}/pulls/${number}/reviews`),
    githubList<{
      id: number;
      user: GitHubUser;
      author_association?: string;
      body: string;
      html_url: string;
      updated_at: string;
    }>(token, `${base}/issues/${number}/comments`),
  ]);
  return [
    ...reviewComments.map((comment) => ({
      githubId: `review_comment:${comment.id}`,
      kind: "review_comment" as const,
      author: comment.user?.login ?? "unknown",
      authorIsBot: isBot(comment.user),
      path: comment.path,
      line: comment.line ?? comment.original_line ?? null,
      body: comment.body,
      url: comment.html_url,
      reviewCommentId: comment.in_reply_to_id ?? comment.id,
      updatedAt: comment.updated_at,
      inReplyTo: comment.in_reply_to_id ?? null,
      trusted: isTrusted(comment.user, comment.author_association),
    })),
    ...reviews
      .filter((review) => review.body?.trim())
      .map((review) => ({
        githubId: `review:${review.id}`,
        kind: "review" as const,
        author: review.user?.login ?? "unknown",
        authorIsBot: isBot(review.user),
        path: null,
        line: null,
        body: review.body ?? "",
        url: review.html_url,
        reviewCommentId: null,
        updatedAt: review.submitted_at ?? new Date(0).toISOString(),
        inReplyTo: null,
        trusted: isTrusted(review.user, review.author_association),
      })),
    ...issueComments.map((comment) => ({
      githubId: `issue_comment:${comment.id}`,
      kind: "issue_comment" as const,
      author: comment.user?.login ?? "unknown",
      authorIsBot: isBot(comment.user),
      path: null,
      line: null,
      body: comment.body,
      url: comment.html_url,
      reviewCommentId: null,
      updatedAt: comment.updated_at,
      inReplyTo: null,
      trusted: isTrusted(comment.user, comment.author_association),
    })),
  ];
}

export async function replyToFeedback(
  repository: CodeRepository,
  number: number,
  input: { reviewCommentId: number | null; body: string },
) {
  const token = await installationToken(repository);
  const base = repoPath(repository);
  if (input.reviewCommentId) {
    await githubRequest(token, `${base}/pulls/${number}/comments/${input.reviewCommentId}/replies`, {
      method: "POST",
      body: { body: input.body },
    });
    return;
  }
  await githubRequest(token, `${base}/issues/${number}/comments`, {
    method: "POST",
    body: { body: input.body },
  });
}

export async function appIdentity(repository: CodeRepository) {
  // Commits are authored by Slab; the push uses the App installation token.
  void repository;
  return { name: "Slab", email: "slab@users.noreply.github.com" };
}
