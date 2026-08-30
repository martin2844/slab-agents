import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/image.yml", import.meta.url),
  "utf8",
);

test("release evidence pipelines propagate producer failures", () => {
  assert.match(
    workflow,
    /defaults:\n\s+run:\n\s+shell: bash -eo pipefail \{0\}/,
  );

  const evidencePipelines = workflow
    .split("\n")
    .filter((line) => line.includes("| tee release-evidence/"));

  assert.ok(evidencePipelines.length >= 7);
});
