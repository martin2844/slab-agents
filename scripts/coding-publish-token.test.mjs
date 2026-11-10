import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("draft PRs are opened with an API token, not the contents-only push token", async () => {
  const source = await readFile(new URL("../lib/coding/orchestrator.ts", import.meta.url), "utf8");
  const call = source.slice(source.indexOf("await createDraftPullRequest("));
  const args = call.slice(0, call.indexOf(");") + 2);
  assert.doesNotMatch(args, /\btoken,?\s*\)/);
  assert.match(source, /installationToken\(repository, "push"\)/);
});

test("a waiting run whose current stage failed shows as failed", async () => {
  const { runBadgeStatus } = await import("../lib/coding/stages.ts");
  const run = { status: "waiting", currentStage: "publish" };
  assert.equal(runBadgeStatus(run, [{ stage: "publish", status: "failed", attempt: 1 }]), "failed");
  assert.equal(runBadgeStatus(run, [{ stage: "publish", status: "waiting_approval", attempt: 1 }]), "waiting_approval");
  assert.equal(runBadgeStatus({ status: "active", currentStage: "pm" }, []), "running");
  assert.equal(runBadgeStatus({ status: "done", currentStage: "final_pass" }, []), "done");
});

test("a failed publish can be retried, and PR titles are picked per repository", async () => {
  const [service, orchestrator, detail] = await Promise.all(
    ["lib/coding/service.ts", "lib/coding/orchestrator.ts", "components/coding/coding-run-detail.tsx"].map((path) =>
      readFile(new URL(`../${path}`, import.meta.url), "utf8"),
    ),
  );
  assert.match(service, /stage\.stage === "publish" && stage\.status === "failed"/);
  assert.match(detail, /Retry publish/);
  assert.match(orchestrator, /sectionFor\(titleSection, run, repository\.fullName\)/);
  assert.match(orchestrator, /sectionFor\(summarySection, run, repository\.fullName\)/);
});
