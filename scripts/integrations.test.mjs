import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Integrations stays focused on external tools while Email is an optional Setting", async () => {
  const [source, settings, emailEditor, catalog] = await Promise.all([
    read("components/integrations-view.tsx"),
    read("components/settings-view.tsx"),
    read("components/email-integration-editor.tsx"),
    read("lib/integrations/catalog.ts"),
  ]);
  assert.match(source, /Active integrations/);
  assert.match(source, /Add integrations/);
  assert.match(source, /Personal API key/);
  assert.match(source, /Datacenter/);
  assert.match(source, /Agent tool access/);
  assert.doesNotMatch(source, /EmailIntegrationEditor|EmailActiveCard/);
  assert.match(settings, /Email/);
  assert.match(settings, /Optional/);
  assert.match(settings, /Configure email/);
  assert.match(emailEditor, /Email service/);
  assert.match(emailEditor, /Proton Bridge/);
  assert.match(emailEditor, /Managed Proton Bridge/);
  assert.match(emailEditor, /Proton\s+password is used for this login only/);
  assert.match(emailEditor, /Connect an existing Bridge instead/);
  assert.match(emailEditor, /Two-factor code/);
  assert.match(
    emailEditor,
    /onClick=\{\(\) => handleEditorOpenChange\(false\)\}/,
  );
  assert.match(emailEditor, /Connect Gmail/);
  assert.match(emailEditor, /Google OAuth/);
  assert.match(emailEditor, /Google client ID/);
  assert.match(emailEditor, /Google client secret/);
  assert.match(emailEditor, /Authorized redirect URI/);
  assert.match(emailEditor, /Save OAuth credentials/);
  assert.match(emailEditor, /Agent access profiles/);
  assert.match(emailEditor, /Approval required/);
  assert.match(emailEditor, /if \(result\.status !== "ok"\)/);
  assert.match(emailEditor, /Mailbox connection failed/);
  assert.match(emailEditor, /Connection failed/);
  assert.match(emailEditor, /Edit mailbox connection/);
  assert.match(emailEditor, /Save changes/);
  assert.match(emailEditor, /method: "PATCH"/);
  assert.match(emailEditor, /WSL mirrored networking/);
  assert.match(settings, /Mailbox issue/);
  assert.match(catalog, /EMAIL_AGENT_PROMPT/);
  assert.doesNotMatch(catalog, /provider: "email"/);
  assert.match(catalog, /custom_mcp|custom_http/);
  assert.match(catalog, /Custom integration/);
  assert.match(source, /custom HTTP integration/);
  assert.match(source, /custom MCP integration/);
});

test("managed Proton Bridge stays behind the Next.js server boundary", async () => {
  const [client, service, connectRoute, challengeRoute, abortRoute] = await Promise.all([
    read("lib/integrations/email-client.ts"),
    read("lib/integrations/email-service.ts"),
    read("app/api/integrations/email/proton/route.ts"),
    read("app/api/integrations/email/proton/challenge/route.ts"),
    read("app/api/integrations/email/proton/abort/route.ts"),
  ]);
  assert.match(client, /import "server-only"/);
  assert.match(client, /\/api\/proton-bridge\/connect/);
  assert.match(client, /\/api\/proton-bridge\/challenge/);
  assert.match(service, /connectManagedProtonBridge/);
  assert.match(service, /account\.managed/);
  assert.match(connectRoute, /connectManagedProtonBridge/);
  assert.match(challengeRoute, /continueManagedProtonBridge/);
  assert.match(abortRoute, /abortManagedProtonBridge/);
  for (const source of [connectRoute, challengeRoute, abortRoute]) {
    assert.doesNotMatch(source, /process\.env/);
    assert.doesNotMatch(source, /SLAB_EMAIL_ADMIN_KEY/);
  }
});

test("Email credentials and one-time connector tokens stay outside browser payloads and SQLite", async () => {
  const [migration, service, vault, client, runner, route] = await Promise.all([
    read("db/migrations/202608180007_email_integration.cjs"),
    read("lib/integrations/email-service.ts"),
    read("lib/integrations/email-token-vault.ts"),
    read("lib/integrations/email-client.ts"),
    read("lib/runner.ts"),
    read("app/api/integrations/email/agents/[agentId]/route.ts"),
  ]);
  assert.doesNotMatch(
    migration,
    /raw_token|token_ciphertext|password|refresh_token/,
  );
  assert.match(migration, /token_id/);
  assert.match(migration, /token_prefix/);
  assert.match(vault, /encryptLocalSecret/);
  assert.match(vault, /email-connector-tokens/);
  assert.match(client, /SLAB_EMAIL_ADMIN_KEY/);
  assert.match(client, /saveGoogleOAuthSettings/);
  assert.doesNotMatch(client, /return.*clientSecret/);
  assert.match(service, /storeEmailConnectorToken/);
  assert.match(service, /readEmailConnectorToken/);
  assert.match(runner, /getAgentEmailMcp/);
  assert.match(runner, /EMAIL_AGENT_PROMPT/);
  assert.doesNotMatch(route, /token|password|credential/i);
});

test("Email send policy is translated to per-tool runtime approval", async () => {
  const service = await read("lib/integrations/email-service.ts");
  assert.match(service, /approval_required/);
  assert.match(service, /email_send/);
  assert.match(service, /email_reply/);
  assert.match(service, /defaultMode: "approve"/);
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
