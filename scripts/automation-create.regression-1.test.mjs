import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Regression: ISSUE-001 — Create automation rendered as type=button and never submitted
// Found by /qa on 2026-08-17
// Report: .gstack/qa-reports/qa-report-localhost-3009-2026-08-17.md
test("the dedicated automation editor saves explicitly without implicit form submission", async () => {
  const source = await readFile(
    new URL("../components/automation-editor.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /<form/);
  assert.match(source, /async function save/);
  assert.match(source, /type="button"/);
  assert.match(source, /disabled=\{saving\}/);
  assert.match(source, /scheduleDraft\.agentId/);
  assert.match(source, /isEmailWorkflowDraftValid\(emailDraft\)/);
  assert.match(source, /Outcome/);
  assert.match(
    source,
    /<SelectItem value="review">Review and decide<\/SelectItem>/,
  );
  assert.match(source, /lifecycleStatus: status/);
});
