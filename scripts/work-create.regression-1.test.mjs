import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Regression: ISSUE-002 — Create issue rendered as type=button and never submitted
// Found by /qa on 2026-08-17
// Report: .gstack/qa-reports/qa-report-localhost-3009-2026-08-17.md
test("the create issue action submits its form", async () => {
  const source = await readFile(
    new URL("../components/work-board.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /<Button type="submit" disabled=\{saving\}>\s*\{saving \? "Creating…" : "Create issue"\}/,
    "Base UI buttons default to type=button, so Create issue must opt into form submission",
  );
});
