import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("integrations expose a catalog, active row, PostHog editor, and custom WIP card", async () => {
  const [source, catalog] = await Promise.all([
    read("components/integrations-view.tsx"),
    read("lib/integrations/catalog.ts"),
  ]);
  assert.match(source, /Active integrations/);
  assert.match(source, /Add integrations/);
  assert.match(source, /Personal API key/);
  assert.match(source, /Datacenter/);
  assert.match(source, /Agent tool access/);
  assert.match(catalog, /Custom integration/);
  assert.match(source, />WIP</);
});

test("PostHog credentials remain server-side and its MCP surface is read-only", async () => {
  const [migration, server, runner] = await Promise.all([
    read("db/migrations/202608170003_integrations.cjs"),
    read("lib/integrations/mcp-server.ts"),
    read("lib/runner.ts"),
  ]);
  assert.match(migration, /credentials_ciphertext/);
  assert.match(migration, /agent_integration_tools/);
  assert.match(server, /readOnlyHint: true/);
  assert.match(server, /Only read-only HogQL queries are allowed/);
  assert.match(runner, /getAgentPostHogMcp/);
  assert.match(runner, /POSTHOG_AGENT_PROMPT/);
});
