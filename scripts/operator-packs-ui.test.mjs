import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("Blueprints are reachable before blank Agent creation", async () => {
  const [navigation, agents, overview] = await Promise.all([
    read("components/workspace-shell.tsx"),
    read("components/agents-view.tsx"),
    read("components/overview-kickstart.tsx"),
  ]);
  assert.match(navigation, /href: "\/packs"[\s\S]*Blueprints/);
  assert.match(agents, /Browse Blueprints/);
  assert.match(agents, /New agent/);
  assert.match(overview, /Choose a Blueprint/);
});

test("Blueprint preview leads with outcomes and keeps package mechanics progressive", async () => {
  const [view, service, documentation] = await Promise.all([
    read("components/packs-view.tsx"),
    read("lib/packs/service.ts"),
    read("docs/operator-packs.md"),
  ]);
  assert.match(view, /Ready-made agent teams, workflows and operating rules/);
  assert.match(view, /Available Blueprints/);
  assert.match(view, /Installed Blueprints/);
  assert.match(view, /What you'll get/);
  assert.match(view, /Required integrations/);
  assert.match(view, /Normal workspace access/);
  assert.match(view, /Keep my existing configuration/);
  assert.match(view, /Replace with Blueprint configuration/);
  assert.match(view, /Dedicated sample records/);
  assert.match(view, /Run test/);
  assert.match(view, /Blueprint installed/);
  assert.match(view, /Installed Blueprint/);
  assert.match(view, /Uninstall Blueprint/);
  assert.match(view, /Advanced Blueprint details/);
  assert.doesNotMatch(view, /MetricStrip/);
  assert.match(
    view,
    /Agents, guides, Work,\s+runs and your edits remain available/,
  );
  assert.match(service, /resource\.state !== "detached"/);
  assert.match(service, /status: "partial_failure"/);
  assert.match(service, /Retry the Blueprint installation to resume/);
  assert.match(service, /withPackInstallLock/);
  assert.match(service, /action: "detach"/);
  assert.match(service, /tag: packResourceTag/);
  assert.match(service, /detachOperatorPackResources/);
  assert.doesNotMatch(service, /DocsClient\.(archive|delete)/);
  assert.match(documentation, /schema has no credential/i);
  assert.match(documentation, /Safe Blueprint tests/);
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

test("installed Blueprint resources link to their product surfaces", async () => {
  const [view, presentation, docsPage, pageData] = await Promise.all([
    read("components/packs-view.tsx"),
    read("lib/packs/presentation.ts"),
    read("app/docs/page.tsx"),
    read("lib/page-data.ts"),
  ]);
  assert.match(view, /installedResources/);
  assert.match(presentation, /`\/agents\/\$\{encodeURIComponent/);
  assert.match(presentation, /`\/automations\/\$\{encodeURIComponent/);
  assert.match(presentation, /`\/docs\?doc=\$\{encodeURIComponent/);
  assert.match(docsPage, /getDocsPageData\(doc\)/);
  assert.match(pageData, /preferredDocumentId/);
});
