import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../components/agent-detail.tsx", import.meta.url),
  "utf8",
);

test("full access control is discoverable in the agent capabilities tab", () => {
  const capabilitiesTab = source.indexOf(
    '<TabsTrigger value="capabilities">Capabilities</TabsTrigger>',
  );
  const accessControl = source.indexOf("Full access to Work & Docs");
  const runsTab = source.indexOf(
    '<TabsTrigger value="runs">Runs</TabsTrigger>',
  );

  assert.notEqual(
    capabilitiesTab,
    -1,
    "agent detail should expose a capabilities tab",
  );
  assert.notEqual(
    accessControl,
    -1,
    "full access control should have a visible label",
  );
  assert.ok(
    capabilitiesTab < runsTab,
    "capabilities should remain a primary tab before run history",
  );
  assert.match(source, /Enable full access/);
});
