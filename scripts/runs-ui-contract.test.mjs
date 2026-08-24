import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Runs refresh keeps the complete page-data contract", async () => {
  const [route, view] = await Promise.all([
    read("app/api/runs/route.ts"),
    read("components/runs-view.tsx"),
  ]);

  assert.match(route, /data: getRunsPageData\(\)/);
  assert.match(view, /api<Partial<RunsData>>\("\/api\/runs"\)/);
  assert.match(view, /agents: next\.agents \?\? previous\.agents/);
  assert.match(view, /const runs = data\?\.runs \?\? \[\]/);
  assert.match(view, /const approvals = data\?\.approvals \?\? \[\]/);
  assert.match(view, /const agents = data\?\.agents \?\? \[\]/);
  assert.doesNotMatch(view, /data\?\.agents\.find/);
});

test("Runs expose their existing product chat without creating another run", async () => {
  const [view, detail] = await Promise.all([
    read("components/runs-view.tsx"),
    read("components/run-detail.tsx"),
  ]);

  for (const source of [view, detail]) {
    assert.match(source, /\/agents\/\$\{[^}]+\}\/threads\/\$\{[^}]+\}/);
    assert.match(source, /Open chat/);
  }
  assert.doesNotMatch(view, /POST[\s\S]*\/api\/threads/);
  assert.doesNotMatch(detail, /POST[\s\S]*\/api\/threads/);
});
