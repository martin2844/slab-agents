import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("calendar capabilities reuse the run-scoped integration boundary", async () => {
  const [service, runner, route, repository] = await Promise.all([
    read("lib/integrations/calendar-service.ts"),
    read("lib/runner.ts"),
    read("app/api/integrations/[id]/mcp/route.ts"),
    read("lib/repository.ts"),
  ]);

  assert.match(
    service,
    /getRunIntegrationCapability\(\s*runId,\s*integrationId,?\s*\)/,
  );
  assert.match(service, /run\.agentId !== capability\.agentId/);
  assert.match(service, /record\.version !== capability\.integrationVersion/);
  assert.match(service, /tokenMatches\(token, capability\.tokenHash\)/);
  assert.match(service, /saveRunIntegrationCapability/);
  assert.match(service, /hasRunIntegrationSnapshot/);
  assert.match(service, /markRunIntegrationSnapshot/);
  assert.match(service, /pending\.integrationVersion/);
  assert.match(service, /completeCalendarOAuth/);
  assert.match(repository, /expectedCredentialsCiphertext/);
  assert.match(repository, /WHERE id=\? AND provider=\? AND version=\?/);
  assert.match(repository, /version=version\+1/);
  assert.match(service, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(service, /filter\(\(capability\)[\s\S]*isCalendarProvider/);
  assert.match(runner, /getAgentCalendarIntegrationsMcp/);
  assert.match(runner, /calendarIntegrations: calendarIntegrations\.map/);
  assert.match(runner, /CALENDAR_AGENT_PROMPT/);
  assert.match(route, /handleCalendarMcpRequest/);
  assert.match(repository, /run_integration_capabilities/);
});

test("calendar writes use existing approvals and read-only providers cannot expose writes", async () => {
  const [service, mcp, repository, contract] = await Promise.all([
    read("lib/integrations/calendar-service.ts"),
    read("lib/integrations/calendar-mcp.ts"),
    read("lib/repository.ts"),
    read("lib/integrations/calendar-contract.ts"),
  ]);

  assert.match(service, /policy === "approval_required"/);
  assert.match(service, /"prompt" as const/);
  assert.match(service, /integration\.provider === "calendar_ics"/);
  assert.match(mcp, /destructiveHint: true/);
  assert.match(mcp, /readOnlyHint: true/);
  assert.match(mcp, /MAX_CONCURRENT_CALENDAR_CALLS = 4/);
  assert.match(
    repository,
    /record\.provider !== "calendar_ics" \|\| tool\.readOnly/,
  );
  assert.match(contract, /"approval_required"/);
});

test("calendar credentials stay encrypted and outside public DTOs", async () => {
  const [service, types, editor, providers] = await Promise.all([
    read("lib/integrations/calendar-service.ts"),
    read("lib/types.ts"),
    read("components/calendar-integration-editor.tsx"),
    read("lib/integrations/calendar-providers.ts"),
  ]);

  assert.match(service, /encryptLocalSecret/);
  assert.match(service, /decryptLocalSecret/);
  const integrationType = types.slice(
    types.indexOf("export type Integration ="),
    types.indexOf("export type IntegrationsPageData"),
  );
  assert.doesNotMatch(
    integrationType,
    /clientSecret|refreshToken|accessToken|password|apiKey|feedUrl/,
  );
  assert.match(editor, /Secrets are encrypted locally and are never returned/);
  assert.doesNotMatch(
    editor,
    /integration\.(clientSecret|refreshToken|accessToken|password|apiKey|feedUrl)/,
  );
  assert.doesNotMatch(providers, /providerError.*message/);
});

test("Calendar is managed in Settings and assignable from Agent capabilities", async () => {
  const [settings, editor, pageData, agentDetail] = await Promise.all([
    read("components/settings-view.tsx"),
    read("components/calendar-integration-editor.tsx"),
    read("lib/page-data.ts"),
    read("components/agent-detail.tsx"),
  ]);

  assert.match(settings, /TabsTrigger value="calendar"/);
  assert.match(settings, /Configure calendar/);
  assert.match(editor, /Google Calendar/);
  assert.match(editor, /Microsoft 365/);
  assert.match(editor, /CalDAV/);
  assert.match(editor, /Cal\.com/);
  assert.match(editor, /Shared calendar URL/);
  assert.match(editor, /Agent access/);
  assert.match(editor, /agentIds: form\.agentIds/);
  assert.doesNotMatch(editor, /Promise\.all\([\s\S]*\/api\/agents\//);
  assert.match(pageData, /integrations: repository\.listIntegrations\(\)/);
  assert.match(agentDetail, /integration\.provider\.startsWith\("calendar_"\)/);
});
