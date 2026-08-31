import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboard = await readFile(
  new URL("../components/overview-dashboard.tsx", import.meta.url),
  "utf8",
);
const kickstart = await readFile(
  new URL("../components/overview-kickstart.tsx", import.meta.url),
  "utf8",
);
const workBoard = await readFile(
  new URL("../components/work-board.tsx", import.meta.url),
  "utf8",
);

test("Overview prioritizes company pulse, operations, pipeline, and activity", () => {
  const sections = [
    'title="Company pulse"',
    'title="Operations"',
    'title="Work pipeline"',
    'title="Activity"',
  ];
  const positions = sections.map((section) => dashboard.indexOf(section));

  assert.equal(positions.every((position) => position >= 0), true);
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
  assert.match(dashboard, /label: "approvals"/);
  assert.match(dashboard, /label: "spend today"/);
  assert.doesNotMatch(dashboard, /label: "integrations"/);
});

test("operational Overview collapses onboarding into a health strip", () => {
  assert.match(kickstart, /Slab is operational/);
  assert.match(kickstart, /Your operation, at a glance\./);
  assert.match(kickstart, /if \(setup\.ready\)/);
  assert.ok(
    kickstart.indexOf("Slab is operational") <
      kickstart.indexOf("First outcome"),
  );
});

test("attention and pipeline links resolve to real Work column anchors", () => {
  for (const stage of ["new", "in_progress", "review", "blocked"]) {
    assert.match(dashboard, new RegExp(`/work#work-${stage}`));
  }
  assert.match(dashboard, /Work source unavailable/);
  assert.match(workBoard, /id=\{`work-\$\{column\.key\}`\}/);
});
