import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("./test-alias-loader.mjs", import.meta.url);
const { buildCustomHttpIntegrationDraft } = await import(
  "../lib/integrations/http-manifest.ts"
);

const metricsDocumentation = `# Agent metrics API

This interface gives trusted agents read-only access to curated business and operational metrics.

## Authentication

Authorization: Bearer <secret>
X-Metrics-Secret: <secret>

## Common query parameters

| Parameter | Default | Rules |
| --- | --- | --- |
| \`from\` | 30 days before \`to\` | ISO timestamp or \`YYYY-MM-DD\` |
| \`to\` | current time | ISO timestamp or inclusive \`YYYY-MM-DD\` |
| \`page\` | \`1\` | Positive integer |
| \`limit\` | \`50\` | Positive integer, maximum \`100\` |
| \`pii\` | \`false\` | \`true\` requires the PII secret |

All successful responses have this envelope:

\`\`\`json
{ "success": true, "data": {} }
\`\`\`

## Endpoints

### \`GET /api/admin/metrics\`

Returns the aggregated snapshot. Use \`include=users,emails,sales\` to request a smaller snapshot.

\`\`\`bash
curl -H "Authorization: Bearer secret" "https://clasific.ar/api/admin/metrics?from=2026-08-01"
\`\`\`

### \`GET /api/admin/metrics/users\`

Returns registration, verification, and activity statistics.

### \`GET /api/admin/metrics/emails\`

Returns delivery totals and delivery records.

### \`GET /api/admin/metrics/reports\`

Returns report creation and fulfillment metrics.

### \`GET /api/admin/metrics/sales\`

Returns completed transaction count and revenue.

### \`GET /api/admin/metrics/api-usage/users\`

Returns paginated API owners ordered by lifetime requests.

### \`GET /api/admin/metrics/api-usage/endpoints\`

Returns endpoint usage for the selected period.
`;

test("metrics documentation becomes a reviewable read-only integration draft", () => {
  const draft = buildCustomHttpIntegrationDraft(metricsDocumentation);

  assert.equal(draft.sourceFormat, "markdown");
  assert.equal(draft.name, "Agent metrics API");
  assert.equal(draft.baseUrl, "https://clasific.ar");
  assert.equal(draft.authType, "bearer");
  assert.equal(draft.operations.length, 7);
  assert.ok(draft.operations.every(({ method }) => method === "GET"));
  assert.ok(
    draft.operations.every(({ responsePath }) => responsePath === "data"),
  );
  assert.ok(draft.warnings.some((warning) => warning.includes("non-PII")));

  const snapshot = draft.operations.find(
    ({ path }) => path === "/api/admin/metrics",
  );
  assert.ok(snapshot);
  assert.deepEqual(
    snapshot.parameters.map(({ name, type }) => [name, type]),
    [
      ["from", "string"],
      ["to", "string"],
      ["page", "integer"],
      ["limit", "integer"],
      ["pii", "boolean"],
      ["include", "string"],
    ],
  );
  assert.doesNotMatch(JSON.stringify(draft), /secret>/i);
});

test("the standardized manifest excludes secrets and write methods", () => {
  const valid = {
    schemaVersion: 1,
    kind: "custom_http",
    name: "Metrics",
    baseUrl: "https://example.com",
    authentication: { type: "api_key_header", headerName: "X-Metrics-Secret" },
    operations: [
      {
        key: "get_metrics",
        name: "Get metrics",
        method: "GET",
        path: "/metrics",
        parameters: [],
      },
    ],
  };
  const draft = buildCustomHttpIntegrationDraft(JSON.stringify(valid));
  assert.equal(draft.sourceFormat, "manifest_json");
  assert.equal(draft.authHeaderName, "X-Metrics-Secret");
  assert.equal(draft.operations[0].maxResponseBytes, 32768);
  assert.equal(draft.operations[0].maxItems, 50);

  assert.throws(() =>
    buildCustomHttpIntegrationDraft(
      JSON.stringify({
        ...valid,
        authentication: { ...valid.authentication, secret: "must-not-parse" },
      }),
    ),
  );
  assert.throws(() =>
    buildCustomHttpIntegrationDraft(
      JSON.stringify({
        ...valid,
        operations: [{ ...valid.operations[0], method: "POST" }],
      }),
    ),
  );
});

test("imported metadata redacts credential-shaped values", () => {
  const draft = buildCustomHttpIntegrationDraft(`# Metrics API

## Common query parameters

| Parameter | Default | Rules |
| --- | --- | --- |
| token | sk-live-TABLESECRET123 | Optional filter |

### GET /metrics

Use password: hunter2 and Authorization: Bearer live-bearer-value.

\`\`\`bash
curl https://example.com/metrics
\`\`\`
`);

  const serialized = JSON.stringify(draft);
  assert.doesNotMatch(serialized, /hunter2/);
  assert.doesNotMatch(serialized, /TABLESECRET/);
  assert.doesNotMatch(serialized, /live-bearer-value/);
  assert.match(serialized, /\[redacted\]/);
});

test("markdown import rejects parameter fan-out beyond the save contract", () => {
  const rows = Array.from(
    { length: 21 },
    (_, index) => `| parameter_${index} | none | Optional |`,
  ).join("\n");
  assert.throws(
    () =>
      buildCustomHttpIntegrationDraft(`# Metrics

## Common query parameters

| Parameter | Default | Rules |
| --- | --- | --- |
${rows}

### GET /metrics

Read metrics.
`),
    /limited to 20/,
  );
});

test("manifest import enforces the same URL, path, and operation contracts as save", () => {
  const base = {
    schemaVersion: 1,
    kind: "custom_http",
    name: "Metrics",
    baseUrl: "https://example.com",
    authentication: { type: "none" },
    operations: [
      {
        key: "get_metrics",
        name: "Get metrics",
        method: "GET",
        path: "/metrics",
        parameters: [],
      },
    ],
  };

  for (const baseUrl of [
    "ftp://example.com",
    "https://user:pass@example.com",
    "https://example.com/api?token=value",
  ]) {
    assert.throws(() =>
      buildCustomHttpIntegrationDraft(JSON.stringify({ ...base, baseUrl })),
    );
  }
  assert.throws(() =>
    buildCustomHttpIntegrationDraft(
      JSON.stringify({
        ...base,
        operations: [{ ...base.operations[0], path: "/../admin" }],
      }),
    ),
  );
  assert.throws(
    () =>
      buildCustomHttpIntegrationDraft(
        JSON.stringify({
          ...base,
          operations: [
            base.operations[0],
            { ...base.operations[0], key: "get metrics" },
          ],
        }),
      ),
    /duplicated after normalization/,
  );
  assert.throws(
    () =>
      buildCustomHttpIntegrationDraft(
        JSON.stringify({
          ...base,
          operations: [
            { ...base.operations[0], path: "/customers/{customerId}" },
          ],
        }),
      ),
    /required path parameter/,
  );
  assert.throws(
    () =>
      buildCustomHttpIntegrationDraft(
        JSON.stringify({
          ...base,
          authentication: { type: "api_key_header" },
        }),
      ),
    /headerName/,
  );
});

test("manifest metadata cannot carry credentials into generated tools", () => {
  const draft = buildCustomHttpIntegrationDraft(
    JSON.stringify({
      schemaVersion: 1,
      kind: "custom_http",
      name: "Metrics TOPSECRET123",
      baseUrl: "https://example.com",
      authentication: { type: "none" },
      operations: [
        {
          key: "get_metrics",
          name: "Get NAMESECRET123 metrics",
          description: "Authorization: Bearer RAW-BEARER-SECRET",
          method: "GET",
          path: "/metrics",
          parameters: [
            {
              name: "scope",
              location: "query",
              type: "string",
              required: false,
              description: "password: PARAMSECRET123",
            },
          ],
        },
      ],
    }),
  );

  const serialized = JSON.stringify(draft);
  for (const secret of [
    "TOPSECRET123",
    "NAMESECRET123",
    "RAW-BEARER-SECRET",
    "PARAMSECRET123",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(secret));
  }
  assert.match(serialized, /\[redacted\]/);
});
