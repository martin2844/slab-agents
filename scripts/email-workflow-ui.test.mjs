import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Email automation UI exposes a stable vertical workflow editor", async () => {
  const [view, editor] = await Promise.all([
    readFile(
      new URL("../components/automations-view.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../components/email-automation-workflow-editor.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(view, /<EmailAutomationWorkflowEditor/);
  assert.match(
    view,
    /emailMatch:\s*triggerType === "email" \? emailDraft\.emailMatch/,
  );
  assert.match(view, /steps: triggerType === "email" \? emailDraft\.steps/);
  assert.match(view, /Edit Email workflow/);
  assert.match(view, /Recent Email workflows/);
  assert.match(view, /href=\{`\/runs\/\$\{step\.runId\}`\}/);

  assert.match(editor, /key=\{step\.id\}/);
  assert.doesNotMatch(editor, /key=\{index\}/);
  assert.match(editor, /When an email is received/);
  assert.match(editor, /Then run these agent steps/);
  assert.match(editor, /value="draft_reply"/);
  assert.match(editor, /value="review_and_reply"/);
  assert.match(editor, /Agent review and operator approval are separate/);
  assert.match(editor, /selectedAccount\.displayName/);
  assert.match(editor, /selectedAgent\.name/);
  assert.match(editor, /w-full min-w-0/);
  assert.match(view, /isEmailWorkflowDraftValid\(emailDraft\)/);
  assert.match(view, /useOperationalPolling/);
  assert.match(view, /\/api\/automations\?activity=1/);
  assert.match(view, /expectedWorkflowVersion: automation\.workflowVersion/);
  assert.doesNotMatch(editor, /crypto\.randomUUID/);
  assert.match(editor, /nextAutomationWorkflowStepId\(draft\.steps\)/);
});

test("workflow filters preserve typed whitespace until server validation", async () => {
  const editor = await readFile(
    new URL(
      "../components/email-automation-workflow-editor.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(editor, /event\.target\.value === ""/);
  assert.doesNotMatch(editor, /event\.target\.value\.trim\(\) \|\| null/);
});
