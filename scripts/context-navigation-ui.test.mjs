import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function navigationGroup(source, label) {
  const match = source.match(
    new RegExp(`label: "${label}",\\n\\s+items: \\[([\\s\\S]*?)\\n\\s+\\],`),
  );
  assert.ok(match, `${label} navigation group is missing`);
  return match[1];
}

test("Docs and Sources live in Context while service setup lives in Connections", async () => {
  const [navigation, sourcesPage, sourcesView, settings, settingsPage, guide] =
    await Promise.all([
      readFile(
        new URL("../components/workspace-shell.tsx", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../app/sources/page.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../components/sources-view.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../components/settings-view.tsx", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../app/settings/page.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../components/how-it-works-guide.tsx", import.meta.url),
        "utf8",
      ),
    ]);
  const contextGroup = navigationGroup(navigation, "Context");
  const configureGroup = navigationGroup(navigation, "Configure");

  assert.match(contextGroup, /href: "\/docs"/);
  assert.match(contextGroup, /href: "\/sources"/);
  assert.doesNotMatch(configureGroup, /href: "\/docs"/);
  assert.doesNotMatch(configureGroup, /href: "\/sources"/);
  assert.doesNotMatch(configureGroup, /href: "\/system"/);
  assert.match(sourcesPage, /getSourcesPageData/);
  assert.match(sourcesView, /Knowledge sources/);
  assert.match(sourcesView, /WordPress/);
  assert.match(sourcesView, /GitHub repository/);
  assert.match(sourcesView, /Website \/ sitemap/);
  assert.match(settings, /SettingsNavigation/);
  assert.match(settings, /navigation\.initialTab === initialTab/);
  assert.match(settings, /activePage === "connections"/);
  assert.match(settings, /title="Workspace sources"/);
  assert.match(settingsPage, /parseSettingsPage/);
  assert.match(guide, /Settings → Connections/);
  assert.doesNotMatch(guide, /Settings → Sources/);
});

test("short navigation viewports keep the middle region scrollable", async () => {
  const navigation = await readFile(
    new URL("../components/workspace-shell.tsx", import.meta.url),
    "utf8",
  );

  assert.equal(navigation.match(/min-h-0 flex-1 overflow-y-auto/g)?.length, 2);
  assert.equal(navigation.match(/shrink-0 px-/g)?.length, 2);
});
