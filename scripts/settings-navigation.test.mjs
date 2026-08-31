import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  clearSettingsCallback,
  parseSettingsPage,
  settingsPageUrl,
} from "../lib/settings-navigation.ts";

test("settings navigation accepts known sections and rejects unknown values", () => {
  assert.equal(parseSettingsPage("operator"), "operator");
  assert.equal(parseSettingsPage("budgets"), "budgets");
  assert.equal(parseSettingsPage("unknown"), "connections");
  assert.equal(parseSettingsPage(undefined), "connections");
});

test("manual settings navigation clears stale OAuth callback results", () => {
  const url = settingsPageUrl(
    "https://agents.example/settings?tab=email&email=connected&calendar=failed",
    "security",
  );

  assert.equal(url.pathname, "/settings");
  assert.equal(url.searchParams.get("tab"), "security");
  assert.equal(url.searchParams.has("email"), false);
  assert.equal(url.searchParams.has("calendar"), false);
});

test("closing an integration editor removes only its callback result", () => {
  const url = clearSettingsCallback(
    "https://agents.example/settings?tab=email&email=connected&calendar=failed",
    "email",
  );

  assert.equal(url.searchParams.get("tab"), "email");
  assert.equal(url.searchParams.has("email"), false);
  assert.equal(url.searchParams.get("calendar"), "failed");
});

test("settings uses a sticky horizontal icon-and-text navigation in product order", async () => {
  const source = await readFile(
    new URL("../components/settings-view.tsx", import.meta.url),
    "utf8",
  );
  const navigation = source.slice(
    source.indexOf("function SettingsNavigation"),
    source.indexOf("function ConnectionPanel"),
  );
  const configuredPages = source
    .match(/const SETTINGS_NAVIGATION[^=]*= \[([\s\S]*?)\n\];/)?.[1]
    ?.match(/"[a-z]+"/g)
    ?.map((page) => page.slice(1, -1));

  assert.deepEqual(configuredPages, [
    "connections",
    "operator",
    "runtime",
    "budgets",
    "memory",
    "email",
    "notifications",
    "calendar",
    "security",
  ]);
  assert.match(navigation, /sticky top-16/);
  assert.match(navigation, /lg:top-0/);
  assert.match(navigation, /overflow-x-auto/);
  assert.match(navigation, /items-end border-b/);
  assert.match(navigation, /after:bg-accent/);
  assert.match(navigation, /icon: Icon/);
  assert.match(
    navigation,
    /<Icon[\s\S]*aria-hidden="true"[\s\S]*className={[\s\S]*size-3\.5/,
  );
  assert.match(navigation, /activeTabRef/);
  assert.match(navigation, /scroller\.scrollTo/);
  assert.match(navigation, /new ResizeObserver/);
  assert.match(navigation, /\[activePage, hasWorkspaceChanges\]/);
  assert.match(navigation, />Unsaved workspace changes</);
  assert.doesNotMatch(navigation, /SETTINGS_GROUPS/);
  assert.doesNotMatch(navigation, /bg-primary text-primary-foreground/);
  assert.doesNotMatch(navigation, /rounded-md/);
});
