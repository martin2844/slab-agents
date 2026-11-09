import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
register("./test-alias-loader.mjs", import.meta.url);
const { docsEditingPlan } = await import("../lib/docs-editing-policy.ts");
test("reviewed Docs writes stage without individual approval while full editing publishes automatically", () => {
  const plan = docsEditingPlan({
    defaultMode: "prompt",
    tools: { get_doc: "approve", archive_doc: "deny" },
  });
  assert.equal(plan.editingMode, "review");
  assert.equal(plan.stagedPolicy.tools.update_doc, "approve");
  assert.equal(plan.stagedPolicy.tools.create_doc, "approve");
  assert.equal(plan.stagedPolicy.tools.archive_doc, "deny");
  assert.equal(plan.stagedPolicy.tools.revert_doc_commit, "deny");
  assert.equal(plan.stagedPolicy.defaultMode, "prompt");
  assert.equal(
    docsEditingPlan({ defaultMode: "approve", tools: {} }).editingMode,
    "auto",
  );
});
test("reverts cannot bypass denied writes or reviews, and policy snapshots remain unchanged", () => {
  const original = { defaultMode: "approve", tools: { update_doc: "prompt" } };
  const plan = docsEditingPlan(original);
  assert.equal(plan.editingMode, "review");
  assert.equal(plan.stagedPolicy.tools.revert_doc_commit, "approve");
  assert.deepEqual(original, {
    defaultMode: "approve",
    tools: { update_doc: "prompt" },
  });
  assert.equal(
    docsEditingPlan({
      defaultMode: "deny",
      tools: { revert_doc_commit: "approve" },
    }).stagedPolicy.tools.revert_doc_commit,
    "deny",
  );
});
