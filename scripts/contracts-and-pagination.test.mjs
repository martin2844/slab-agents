import assert from "node:assert/strict";
import test from "node:test";

import {
  automationCreateSchema,
  automationUpdateSchema,
} from "../lib/api-schemas/automation.ts";
import { compileMcpInputSchema } from "../lib/integrations/json-schema.ts";
import { collectOffsetPages } from "../lib/pagination.ts";
import { mapWithConcurrency } from "../lib/async.ts";

test("automation create and update share cron validation", () => {
  assert.throws(() =>
    automationCreateSchema.parse({
      name: "Daily review",
      agentId: crypto.randomUUID(),
      cronExpression: "not a cron",
      prompt: "Review operations",
    }),
  );
  assert.throws(() =>
    automationUpdateSchema.parse({ cronExpression: "not a cron" }),
  );
  assert.equal(
    automationUpdateSchema.parse({ cronExpression: "0 8 * * 1-5" })
      .cronExpression,
    "0 8 * * 1-5",
  );
});

test("offset pagination collects every page and fails closed at its bound", async () => {
  const values = Array.from({ length: 205 }, (_, index) => index);
  const offsets = [];
  const result = await collectOffsetPages({
    pageSize: 100,
    maxItems: 1_000,
    label: "fixture",
    fetchPage: async (limit, offset) => {
      offsets.push(offset);
      return {
        items: values.slice(offset, offset + limit),
        total: values.length,
      };
    },
  });
  assert.deepEqual(offsets, [0, 100, 200]);
  assert.deepEqual(result, values);

  const cappedPages = [];
  assert.deepEqual(
    await collectOffsetPages({
      pageSize: 100,
      maxItems: 20,
      label: "server-capped fixture",
      fetchPage: async (_limit, offset) => {
        cappedPages.push(offset);
        return offset === 0
          ? { items: [1, 2], hasMore: true }
          : { items: [3], hasMore: false };
      },
    }),
    [1, 2, 3],
  );
  assert.deepEqual(cappedPages, [0, 2]);

  const exact = [1, 2, 3, 4];
  assert.deepEqual(
    await collectOffsetPages({
      pageSize: 2,
      maxItems: 4,
      label: "exact fixture",
      fetchPage: async (limit, offset) => ({
        items: exact.slice(offset, offset + limit),
      }),
    }),
    exact,
  );

  await assert.rejects(
    collectOffsetPages({
      pageSize: 2,
      maxItems: 4,
      label: "bounded fixture",
      fetchPage: async () => ({ items: [1, 2], hasMore: true }),
    }),
    /safety limit/,
  );
});

test("remote MCP schemas preserve provider constraints", () => {
  const schema = compileMcpInputSchema({
    type: "object",
    additionalProperties: false,
    properties: {
      state: { type: "string", enum: ["new", "done"] },
      count: { type: "integer", minimum: 1, maximum: 3 },
    },
    required: ["state", "count"],
  });
  assert.deepEqual(schema.parse({ state: "done", count: 2 }), {
    state: "done",
    count: 2,
  });
  assert.throws(() => schema.parse({ state: "other", count: 2 }));
  assert.throws(() => schema.parse({ state: "done", count: 1.5 }));
  assert.throws(() => schema.parse({ state: "done", count: 4 }));
  assert.throws(() => schema.parse({ state: "done", count: 2, extra: true }));
  assert.throws(() => compileMcpInputSchema(true), /expected an object/);
});

test("bounded concurrency waits for every worker before reporting failure", async () => {
  const completed = [];
  const started = [];
  await assert.rejects(
    mapWithConcurrency(
      ["fail", "slow", "never-1", "never-2"],
      2,
      async (value) => {
        started.push(value);
        if (value === "fail") throw new Error("worker failed");
        await new Promise((resolve) => setTimeout(resolve, 20));
        completed.push(value);
      },
    ),
    /worker failed/,
  );
  assert.deepEqual(completed, ["slow"]);
  assert.deepEqual(
    started.sort(),
    ["fail", "slow"],
    "workers stop claiming new values after the first failure",
  );
});
