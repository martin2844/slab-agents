import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register("./test-alias-loader.mjs", import.meta.url);

const { proposeCustomHttpIntegrationEdit } =
  await import("../lib/integrations/http-ai-edit.ts");
const { customHttpEditableDefinitionSchema } =
  await import("../lib/api-schemas/integration.ts");

const current = {
  schemaVersion: 1,
  name: "Clasificar metrics",
  baseUrl: "https://clasific.ar",
  authType: "bearer",
  timeoutMs: 15_000,
  operations: [
    {
      key: "get_metrics",
      name: "Get metrics",
      description: "Read the metrics snapshot.",
      method: "GET",
      path: "/api/admin/metrics",
      parameters: [],
      responsePath: "data",
      maxResponseBytes: 32_768,
      maxItems: 50,
    },
  ],
};

function generated(message, inspect) {
  return async (input) => {
    inspect?.(input);
    return {
      message: JSON.stringify(message),
      runtime: { id: "codex", model: null },
      usage: { totalTokens: 321 },
    };
  };
}

test("AI edit returns a validated semantic diff without changing connection metadata", async () => {
  const proposal = await proposeCustomHttpIntegrationEdit(
    {
      current,
      instruction: "Add the documented API owners operation.",
    },
    {
      generate: generated({
        summary: "Added API owner usage.",
        operations: [
          ...current.operations,
          {
            key: "get_api_usage_users",
            name: "Get API usage users",
            description: "Read paginated API owner usage.",
            method: "GET",
            path: "/api/admin/metrics/api-usage/users",
            parameters: [
              {
                name: "limit",
                location: "query",
                type: "integer",
                required: false,
                description: "Page size up to 100.",
              },
            ],
            responsePath: "data",
            maxResponseBytes: 32768,
            maxItems: 50,
          },
        ],
      }),
    },
  );

  assert.equal(proposal.draft.sourceFormat, "ai");
  assert.equal(proposal.draft.baseUrl, current.baseUrl);
  assert.equal(proposal.draft.authType, current.authType);
  assert.equal(proposal.draft.operations.length, 2);
  assert.deepEqual(proposal.changes, [
    {
      kind: "added",
      operationKey: "get_api_usage_users",
      field: null,
      before: null,
      after: "GET /api/admin/metrics/api-usage/users · Get API usage users",
    },
  ]);
});

test("AI edit rejects write operations rather than weakening the HTTP contract", async () => {
  await assert.rejects(
    proposeCustomHttpIntegrationEdit(
      { current, instruction: "Add a mutation." },
      {
        generate: generated({
          summary: "Added a write.",
          operations: [{ ...current.operations[0], method: "POST" }],
        }),
      },
    ),
    /proposed manifest is invalid/i,
  );
});

test("instructions and documentation are redacted before reaching Codex", async () => {
  const sensitive = "sk-live-SHOULDNEVERREACHMODEL";
  await proposeCustomHttpIntegrationEdit(
    {
      current,
      instruction: `Fix the endpoint. token=${sensitive}`,
      documentation: `Authorization: Bearer ${sensitive}`,
    },
    {
      generate: generated(
        { summary: "No change needed.", operations: current.operations },
        (input) => {
          assert.doesNotMatch(input.message, /SHOULDNEVERREACHMODEL/);
          assert.match(input.message, /\[redacted\]/);
        },
      ),
    },
  );
});

test("the AI route input contract rejects credentials and arbitrary fields", () => {
  assert.throws(() =>
    customHttpEditableDefinitionSchema.parse({
      ...current,
      secret: "must-not-cross-the-boundary",
    }),
  );
  assert.throws(() =>
    customHttpEditableDefinitionSchema.parse({
      ...current,
      operations: [
        { ...current.operations[0], headers: { Authorization: "x" } },
      ],
    }),
  );
});

test("AI edit UI keeps proposal generation, apply, and persistence separate", async () => {
  const [editor, route, runner] = await Promise.all([
    readFile(
      new URL("../components/custom-http-ai-editor.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/integrations/ai-edit/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/runner.ts", import.meta.url), "utf8"),
  ]);

  assert.match(editor, /Proposed changes/);
  assert.match(editor, /Apply proposal/);
  assert.match(editor, /unsaved form only/);
  assert.doesNotMatch(editor, /secret\s*[,}]/i);
  assert.match(route, /customHttpEditableDefinitionSchema/);
  assert.match(runner, /mcpServers: \[\]/);
  assert.match(runner, /AI_ASSISTANT_TOOL_REQUESTED/);
  assert.match(runner, /runtimeThreadId: null/);
});
