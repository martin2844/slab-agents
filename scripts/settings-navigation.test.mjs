import assert from "node:assert/strict";
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
