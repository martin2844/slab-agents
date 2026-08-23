import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("Operator Packs are reachable before blank Agent creation", async () => {
  const [navigation, agents, overview] = await Promise.all([
    read("components/workspace-shell.tsx"),
    read("components/agents-view.tsx"),
    read("components/overview-kickstart.tsx"),
  ]);
  assert.match(navigation, /href: "\/packs"[\s\S]*Operator Packs/);
  assert.match(agents, /Browse Operator Packs/);
  assert.match(agents, /New agent/);
  assert.match(overview, /Choose an Operator Pack/);
});

test("install preview exposes values, permissions, conflicts, and conservative removal", async () => {
  const [view, service, documentation] = await Promise.all([
    read("components/packs-view.tsx"),
    read("lib/packs/service.ts"),
    read("docs/operator-packs.md"),
  ]);
  assert.match(view, /ResourceSnapshot\s+title="Proposed"/);
  assert.match(view, /ResourceSnapshot\s+title="Current"/);
  assert.match(view, /ResourceSnapshot\s+title="Last applied baseline"/);
  assert.match(view, /Permission policy/);
  assert.match(view, /Keep existing \(recommended\)/);
  assert.match(view, /Replace and \{installLabel\.toLocaleLowerCase\(\)\}/);
  assert.match(view, /Inspect fixture, prompt, and rubric/);
  assert.match(
    view,
    /Agents,\s+Docs,\s+Work,\s+Runs,\s+and user changes\s+are preserved/,
  );
  assert.match(service, /status: "partial_failure"/);
  assert.match(service, /Retry the installation to resume/);
  assert.match(service, /withPackInstallLock/);
  assert.match(service, /action: "detach"/);
  assert.match(service, /tag: packResourceTag/);
  assert.match(service, /detachOperatorPackResources/);
  assert.doesNotMatch(service, /DocsClient\.(archive|delete)/);
  assert.match(documentation, /schema has no credential/i);
  assert.match(documentation, /Synthetic acceptance/);
});

test("pack routes expose preview, install, disable, import, export, and acceptance", async () => {
  const paths = [
    "app/api/packs/route.ts",
    "app/api/packs/[id]/route.ts",
    "app/api/packs/[id]/install/route.ts",
    "app/api/packs/[id]/disable/route.ts",
    "app/api/packs/[id]/export/route.ts",
    "app/api/packs/[id]/acceptance/route.ts",
    "app/api/packs/[id]/acceptance/[acceptanceId]/route.ts",
  ];
  const sources = await Promise.all(paths.map(read));
  assert.equal(sources.length, paths.length);
  assert.match(sources[0], /importOperatorPack/);
  assert.match(sources[1], /previewOperatorPack/);
  assert.match(sources[2], /installOperatorPack/);
  assert.match(sources[3], /disableOperatorPack/);
  assert.match(sources[4], /exportOperatorPack/);
  assert.match(sources[5], /startOperatorPackAcceptance/);
  assert.match(sources[6], /refreshOperatorPackAcceptance/);
});
