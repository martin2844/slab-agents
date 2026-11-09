import "server-only";

import { WorkClient } from "@/lib/mcp/work-client";
import { configuredPublicOrigin } from "@/lib/request-origin";
import type { CodeRun } from "@/lib/coding/types";
import type { Issue } from "@/lib/types";

const AUTHOR = "Slab Coding";

function runLink(run: CodeRun) {
  const origin = configuredPublicOrigin();
  return origin ? `${origin.replace(/\/$/, "")}/coding/${run.number}` : `/coding/${run.number}`;
}

async function bestEffort(label: string, action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    console.error(`[coding] Work sync failed: ${label}`, error);
  }
}

export function syncRunStarted(run: CodeRun, repository: string) {
  return bestEffort("run started", async () => {
    await WorkClient.updateIssue(run.issueKey, { status: "in_progress" });
    await WorkClient.addComment(
      run.issueKey,
      AUTHOR,
      `Coding run #${run.number} started on \`${repository}\` (branch \`${run.branch}\`). Follow it at ${runLink(run)}.`,
    );
  });
}

export function syncPullRequestOpened(run: CodeRun, url: string) {
  return bestEffort("pull request opened", async () => {
    await WorkClient.addComment(
      run.issueKey,
      AUTHOR,
      `Coding run #${run.number} opened a draft pull request: ${url}`,
    );
    await WorkClient.updateIssue(run.issueKey, {
      status: "review" satisfies Issue["status"],
    });
  });
}

export function syncPullRequestMerged(run: CodeRun) {
  return bestEffort("pull request merged", async () => {
    await WorkClient.updateIssue(run.issueKey, {
      status: "done" satisfies Issue["status"],
    });
    await WorkClient.addComment(
      run.issueKey,
      AUTHOR,
      `The pull request of coding run #${run.number} was merged${run.prUrl ? `: ${run.prUrl}` : "."}`,
    );
  });
}

export function syncRunStopped(run: CodeRun, reason: string) {
  return bestEffort("run stopped", () =>
    WorkClient.addComment(
      run.issueKey,
      AUTHOR,
      `Coding run #${run.number} stopped: ${reason}`,
    ),
  );
}

export async function workItemContext(issueKey: string) {
  const issue = await WorkClient.getIssue(issueKey);
  const comments = await WorkClient.listComments(issueKey).catch(() => []);
  return { issue, comments };
}
