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
