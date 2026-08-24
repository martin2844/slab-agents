import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("budget settings preserve editable drafts and stable pricing row identity", async () => {
  const source = await readFile(
    new URL("../components/budget-settings.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /type BudgetDraft =/);
  assert.match(source, /key=\{price\.clientId\}/);
  assert.match(source, /inputUsdPerMillion: string/);
  assert.doesNotMatch(source, /Number\(next\)/);
  assert.doesNotMatch(
    source,
    /key=\{`\$\{price\.runtimeId\}:\$\{price\.model\}/,
  );
});

test("Run Detail distinguishes budget policy skips from stale Work triggers", async () => {
  const source = await readFile(
    new URL("../components/run-detail.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /skipped\?\.payload\.reason === "budget_rejected"/);
  assert.match(source, /Skipped · budget policy/);
  assert.match(source, /budgetSkipReason/);
  assert.match(source, /!budgetSkipped/);
});
