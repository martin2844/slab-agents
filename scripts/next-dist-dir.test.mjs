import assert from "node:assert/strict";
import test from "node:test";
import { resolveNextDistDir } from "../lib/next-dist-dir.ts";

test("development and production never share their default build output", () => {
  assert.equal(resolveNextDistDir({ NODE_ENV: "development" }), ".next-dev");
  assert.equal(resolveNextDistDir({ NODE_ENV: "production" }), ".next");
});

test("an explicit verification directory is honored", () => {
  assert.equal(
    resolveNextDistDir({
      NODE_ENV: "production",
      NEXT_DIST_DIR: ".next-check",
    }),
    ".next-check",
  );
  assert.equal(
    resolveNextDistDir({ NODE_ENV: "development", NEXT_DIST_DIR: "  " }),
    ".next-dev",
  );
});
