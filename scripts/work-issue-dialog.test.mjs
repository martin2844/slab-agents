import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../components/work-board.tsx", import.meta.url),
  "utf8",
);

test("work issue details use a centered dialog with explicit edit actions", () => {
  assert.match(source, /function IssueDialog/);
  assert.doesNotMatch(source, /function IssueDrawer|<Sheet/);
  assert.match(source, /sm:max-w-4xl/);
  assert.match(source, /onDoubleClick=\{startEditing\}/);
  assert.match(source, />\s*Cancel\s*</);
  assert.match(source, /Save changes/);
});

test("work issue descriptions render and preview GitHub-flavored Markdown", () => {
  assert.match(source, /remarkPlugins=\{\[remarkGfm\]\}/);
  assert.match(source, /Double-click to edit/);
  assert.match(source, /Nothing to preview yet/);
});
