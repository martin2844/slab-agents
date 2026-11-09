import assert from "node:assert/strict";
import test from "node:test";
import { documentLineDiff } from "../lib/document-diff.ts";

test("document diffs reconstruct both documents, including insertions, deletions and repeated lines", () => {
  for (const [before, after] of [
    ["a\nb\nc", "a\nx\nc"],
    ["", "a\n"],
    ["a\n", ""],
    ["a\na\nb", "a\nb\na"],
    ["same", "same"],
  ]) {
    const lines = documentLineDiff(before, after);
    assert.equal(
      lines
        .filter((line) => line.kind !== "added")
        .map((line) => line.text)
        .join("\n"),
      before,
    );
    assert.equal(
      lines
        .filter((line) => line.kind !== "removed")
        .map((line) => line.text)
        .join("\n"),
      after,
    );
  }
  assert.deepEqual(
    documentLineDiff("a\nb", "a\nc").map((line) => line.kind),
    ["same", "removed", "added"],
  );
});
test("large replacements remain complete with bounded diff computation", () => {
  const before = Array.from({ length: 1000 }, (_, i) => "old " + i).join("\n");
  const after = Array.from({ length: 1000 }, (_, i) => "new " + i).join("\n");
  const diff = documentLineDiff(before, after);
  assert.equal(diff.length, 2000);
  assert.equal(
    diff
      .filter((line) => line.kind === "removed")
      .map((line) => line.text)
      .join("\n"),
    before,
  );
  assert.equal(
    diff
      .filter((line) => line.kind === "added")
      .map((line) => line.text)
      .join("\n"),
    after,
  );
});
