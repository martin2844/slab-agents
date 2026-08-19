import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Run now is available to every agent and quick tasks are data-driven", async () => {
  const [listSource, detailSource, migration] = await Promise.all([
    readFile(new URL("../components/agents-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/agent-detail.tsx", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../db/migrations/202608170004_agent_quick_actions.cjs",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.doesNotMatch(listSource, /agent\.slug === ["']coo["']/);
  assert.doesNotMatch(detailSource, /agent\.slug === ["']coo["']/);
  assert.match(listSource, /agents\.map\(\(agent\) =>/);
  assert.match(listSource, /<AgentRunDialog[\s\S]*label="Run now"/);
  assert.match(listSource, /defaultMode="review"/);
  assert.match(detailSource, /label="Run now"[\s\S]*defaultMode="review"/);
  assert.match(detailSource, /<AgentQuickActionsEditor/);
  assert.match(migration, /createTable\("agent_quick_actions"/);
});
