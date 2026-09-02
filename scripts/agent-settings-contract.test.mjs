import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("agent settings reuse Email profile management and expose Codex reasoning controls", async () => {
  const [agentDetail, emailSettings, emailAccess, agentPage, runner] =
    await Promise.all([
      read("components/agent-detail.tsx"),
      read("components/email-integration-editor.tsx"),
      read("components/agent-email-access-editor.tsx"),
      read("app/agents/[id]/page.tsx"),
      read("lib/runner.ts"),
    ]);

  assert.match(agentDetail, /AgentEmailAccessEditor/);
  assert.match(emailSettings, /AgentEmailAccessEditor/);
  assert.match(agentDetail, /Reasoning effort/);
  assert.match(agentDetail, /reasoningEffortsForModel/);
  assert.match(agentPage, /getEmailIntegrationState/);
  assert.match(
    emailAccess,
    /\/api\/integrations\/email\/agents\/\$\{agent\.id\}/,
  );
  assert.match(emailAccess, /readEnabled/);
  assert.match(emailAccess, /draftEnabled/);
  assert.match(emailAccess, /sendEnabled/);
  assert.match(emailAccess, /sendPolicy/);
  assert.doesNotMatch(emailAccess, /createdToken|rawToken|bearerToken/);
  assert.match(runner, /reasoningEffort === "default"/);
  assert.match(runner, /effort:/);
});
