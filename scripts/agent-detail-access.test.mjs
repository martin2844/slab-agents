import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../components/agent-detail.tsx", import.meta.url),
  "utf8",
);

test("full access control is discoverable before agent activity", () => {
  const accessControl = source.indexOf("Full access to Work & Docs");
  const threads = source.indexOf(">Threads<");
  const runs = source.indexOf(">Recent runs<");

  assert.notEqual(
    accessControl,
    -1,
    "full access control should have a visible label",
  );
  assert.ok(
    accessControl < threads,
    "full access control should appear before threads",
  );
  assert.ok(
    accessControl < runs,
    "full access control should appear before runs",
  );
  assert.match(source, /Enable full access/);
});
