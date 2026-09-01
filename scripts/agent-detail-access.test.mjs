import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const detailSource = await readFile(
  new URL("../components/agent-detail.tsx", import.meta.url),
  "utf8",
);
const editorSource = await readFile(
  new URL("../components/agent-tool-policy-editor.tsx", import.meta.url),
  "utf8",
);

test("granular tool permissions are discoverable in the capabilities tab", () => {
  const capabilitiesTab = detailSource.indexOf("capabilities: {");
  const accessControl = detailSource.indexOf("AgentToolPolicyEditor");
  const runsTab = detailSource.indexOf("runs: {");

  assert.notEqual(
    capabilitiesTab,
    -1,
    "agent detail should expose a capabilities tab",
  );
  assert.notEqual(
    accessControl,
    -1,
    "the capabilities tab should render the policy editor",
  );
  assert.ok(
    capabilitiesTab < runsTab,
    "capabilities should remain a primary tab before run history",
  );
  assert.match(editorSource, /Tool permissions/);
  assert.match(editorSource, /No access/);
  assert.match(editorSource, /Ask/);
  assert.match(editorSource, /Allow/);
  assert.match(editorSource, /Guarded/);
  assert.match(editorSource, /Routine work runs automatically/);
  assert.match(editorSource, /YOLO/);
  assert.match(editorSource, /runtime sandbox restrictions/);
  assert.match(editorSource, /expectedVersion/);
  assert.match(editorSource, /\/tool-policies/);
  assert.match(editorSource, /type="radio"/);
  assert.doesNotMatch(editorSource, /role="radio"/);
  assert.doesNotMatch(detailSource, /Full access to Work & Docs/);
  assert.match(detailSource, /SectionNavigationFrame/);
  assert.match(detailSource, /SettingSection/);
  assert.match(detailSource, /SettingRow/);
  assert.doesNotMatch(detailSource, /rounded-lg border bg-card p-4/);
});
