import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createGoogleDataAdapter,
  GoogleDataError,
} from "../lib/integrations/google-data-client.ts";
import {
  GOOGLE_ANALYTICS_TOOL_KEYS,
  GOOGLE_SEARCH_CONSOLE_TOOL_KEYS,
} from "../lib/integrations/google-data-contract.ts";
import { googleDataIntegrationSchema } from "../lib/integrations/google-data-schema.ts";
import { GOOGLE_OAUTH_CALLBACK_PATH } from "../lib/integrations/google-oauth-contract.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function withFetch(mock, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await run();
  } finally {
    globalThis.fetch = previous;
  }
}

test("Google data integration schemas and tool keys are explicit", () => {
  assert.equal(
    googleDataIntegrationSchema.safeParse({
      provider: "google_search_console",
      name: "Search Console",
      reuseGmailOAuthCredentials: true,
    }).success,
    true,
  );
  assert.equal(
    googleDataIntegrationSchema.safeParse({
      provider: "google_analytics",
      name: "Analytics",
      clientId: "client",
      clientSecret: "secret",
    }).success,
    true,
  );
  assert.equal(
    googleDataIntegrationSchema.safeParse({
      provider: "google_drive",
      name: "Drive",
    }).success,
    false,
  );
  const keys = [
    ...GOOGLE_ANALYTICS_TOOL_KEYS,
    ...GOOGLE_SEARCH_CONSOLE_TOOL_KEYS,
  ];
  assert.equal(new Set(keys).size, 8);
  assert.ok(keys.every((key) => /^(google_analytics|search_console)_/.test(key)));
});

test("Gmail OAuth reuse stays on the authenticated server boundary", async () => {
  const [client, service, publicRoute] = await Promise.all([
    read("lib/integrations/email-client.ts"),
    read("lib/integrations/google-data-service.ts"),
    read("app/api/integrations/email/gmail/settings/route.ts"),
  ]);
  assert.match(client, /\/api\/settings\/google-oauth\/credentials/);
  assert.match(client, /method: "POST"/);
  assert.match(client, /purpose: "google_data"/);
  assert.match(service, /getGmailOAuthCredentialsForGoogleData/);
  assert.match(service, /encryptLocalSecret\(JSON\.stringify\(credentials\)\)/);
  assert.doesNotMatch(publicRoute, /getGoogleOAuthCredentialsForReuse/);
});

test("Google integration cards use local product marks", async () => {
  const [view, analyticsMark, searchConsoleMark] = await Promise.all([
    read("components/integrations-view.tsx"),
    read("public/integrations/google-analytics.svg"),
    read("public/integrations/google-search-console.svg"),
  ]);

  assert.match(view, /\/integrations\/google-analytics\.svg/);
  assert.match(view, /\/integrations\/google-search-console\.svg/);
  assert.match(analyticsMark, /<svg/);
  assert.match(searchConsoleMark, /^<svg/);
  assert.doesNotMatch(view, /ChartNoAxesCombined/);
});

test("Google Data displays the workspace-wide Google callback", async () => {
  const editor = await read("components/google-data-integration-editor.tsx");
  assert.equal(
    GOOGLE_OAUTH_CALLBACK_PATH,
    "/api/integrations/email/google/callback",
  );
  assert.match(editor, /googleOAuthCallbackUrl/);
  assert.match(editor, /Workspace Google callback/);
});

test("Google Analytics lists properties and runs bounded reports", async () => {
  const requests = [];
  await withFetch(
    async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({ rows: [], accountSummaries: [] });
    },
    async () => {
      const adapter = createGoogleDataAdapter(
        "google_analytics",
        {
          clientId: "client",
          clientSecret: "client-secret",
          accessToken: "access-secret",
          accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
        },
        () => assert.fail("fresh access tokens must not be rewritten"),
      );
      await adapter.listAnalyticsProperties({ pageSize: 999 });
      await adapter.runAnalyticsReport({
        propertyId: "properties/1234",
        startDate: "30daysAgo",
        endDate: "yesterday",
        dimensions: ["sessionSource"],
        metrics: ["sessions"],
        limit: 20_000,
      });
    },
  );
  assert.match(requests[0].url, /accountSummaries\?pageSize=200$/);
  assert.equal(requests[0].init.headers.Authorization, "Bearer access-secret");
  assert.equal(requests[0].init.redirect, "manual");
  assert.match(requests[1].url, /properties\/1234:runReport$/);
  const reportBody = JSON.parse(requests[1].init.body);
  assert.equal(reportBody.limit, "500");
  assert.deepEqual(reportBody.dimensions, [{ name: "sessionSource" }]);
});

test("Search Console uses exact encoded properties and bounded rows", async () => {
  let request;
  await withFetch(
    async (url, init) => {
      request = { url: String(url), init };
      return Response.json({ rows: [] });
    },
    async () => {
      const adapter = createGoogleDataAdapter(
        "google_search_console",
        {
          clientId: "client",
          clientSecret: "client-secret",
          accessToken: "access-secret",
          accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
        },
        () => {},
      );
      await adapter.querySearchPerformance({
        siteUrl: "sc-domain:example.com",
        startDate: "2026-08-01",
        endDate: "2026-08-31",
        dimensions: ["query", "page"],
        rowLimit: 50_000,
      });
    },
  );
  assert.match(
    request.url,
    /sites\/sc-domain%3Aexample\.com\/searchAnalytics\/query$/,
  );
  assert.equal(JSON.parse(request.init.body).rowLimit, 1000);
  assert.equal(request.init.headers.Authorization, "Bearer access-secret");
});

test("Search Console rejects an inverted date range before making a request", async () => {
  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      return Response.json({ rows: [] });
    },
    async () => {
      const adapter = createGoogleDataAdapter(
        "google_search_console",
        {
          clientId: "client",
          clientSecret: "client-secret",
          accessToken: "access-secret",
          accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
        },
        () => {},
      );
      await assert.rejects(
        () =>
          adapter.querySearchPerformance({
            siteUrl: "sc-domain:example.com",
            startDate: "2026-08-31",
            endDate: "2026-08-01",
            dimensions: ["query"],
          }),
        (error) =>
          error instanceof GoogleDataError &&
          error.code === "GOOGLE_INVALID_INPUT",
      );
    },
  );
  assert.equal(calls, 0);
});

test("Google refresh tokens stay server-side and provider errors redact secrets", async () => {
  const updates = [];
  let call = 0;
  await withFetch(
    async (url) => {
      call += 1;
      if (String(url).includes("oauth2.googleapis.com/token")) {
        return Response.json({ access_token: "new-access", expires_in: 3600 });
      }
      return Response.json(
        { error: { message: "new-access was rejected" } },
        { status: 403 },
      );
    },
    async () => {
      const adapter = createGoogleDataAdapter(
        "google_search_console",
        {
          clientId: "client",
          clientSecret: "client-secret",
          refreshToken: "refresh-secret",
        },
        (credentials) => updates.push(credentials),
      );
      await assert.rejects(
        () => adapter.listSearchConsoleSites(),
        (error) =>
          error instanceof GoogleDataError &&
          error.code === "GOOGLE_AUTH_FAILED" &&
          !error.message.includes("new-access") &&
          !error.message.includes("refresh-secret"),
      );
    },
  );
  assert.equal(call, 2);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].accessToken, "new-access");
});

test("Google integrations are indexed into run-scoped MCP capabilities", async () => {
  const [runner, route, server, catalog, editor, repository, packs] =
    await Promise.all([
      read("lib/runner.ts"),
      read("app/api/integrations/[id]/mcp/route.ts"),
      read("lib/integrations/google-data-mcp.ts"),
      read("lib/integrations/catalog.ts"),
      read("components/google-data-integration-editor.tsx"),
      read("lib/repositories/integration-records.ts"),
      read("lib/packs/service.ts"),
    ]);
  assert.match(runner, /getAgentGoogleDataIntegrationsMcp/);
  assert.match(runner, /googleDataIntegrations/);
  assert.match(runner, /GOOGLE_DATA_AGENT_PROMPT/);
  assert.match(route, /handleGoogleDataMcpRequest/);
  assert.match(repository, /GOOGLE_ANALYTICS_TOOLS/);
  assert.match(repository, /GOOGLE_SEARCH_CONSOLE_TOOLS/);
  assert.match(catalog, /google_analytics_run_report/);
  assert.match(catalog, /search_console_query_performance/);
  assert.match(editor, /Agent tool access/);
  assert.match(editor, /run-scoped/);
  assert.match(editor, /Reuse Gmail credentials/);
  assert.match(editor, /reuseGmailOAuthCredentials/);
  assert.match(
    packs,
    /integration\.provider === "posthog" \|\|\s*integration\.provider === "google_analytics"/,
  );
  const annotations = server.match(/annotations: readAnnotations/g) ?? [];
  assert.equal(annotations.length, 8);
  assert.match(server, /openWorldHint: true/);
});
