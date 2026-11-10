import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  findLemonSqueezyCustomer,
  lemonSqueezySalesSummary,
  listLemonSqueezyOrders,
  listLemonSqueezySubscriptions,
  resolveDateRange,
  testLemonSqueezyConnection,
} from "../lib/integrations/lemonsqueezy.ts";

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

const page = (data) => ({
  data,
  meta: { page: { currentPage: 1, lastPage: 1 } },
});
const item = (id, attributes) => ({ id: String(id), attributes });

const fixtures = {
  stores: [
    item(1, {
      name: "CleanCut Video",
      total_sales: 9,
      total_revenue: 30000,
      thirty_day_sales: 2,
      thirty_day_revenue: 6698,
    }),
  ],
  orders: [
    item(30, {
      status: "paid",
      created_at: "2026-11-02T09:00:00Z",
      total_usd: 5999,
      tax_usd: 1082,
      refunded_amount_usd: 0,
      user_email: "buyer@example.com",
      user_name: "Buyer Person",
      first_order_item: { product_name: "Yearly", variant_name: "Default", product_id: 2 },
    }),
    item(29, {
      status: "refunded",
      created_at: "2026-10-20T09:00:00Z",
      total_usd: 699,
      tax_usd: 0,
      refunded_amount_usd: 699,
      user_email: "other@example.com",
      first_order_item: { product_name: "Monthly", variant_name: "Default", product_id: 1 },
    }),
    item(28, {
      status: "paid",
      created_at: "2026-10-05T09:00:00Z",
      total_usd: 699,
      tax_usd: 0,
      refunded_amount_usd: 0,
      first_order_item: { product_name: "Monthly", product_id: 1 },
    }),
  ],
  subscriptions: [
    item(12, {
      status: "active",
      created_at: "2026-11-02T09:00:00Z",
      product_name: "Yearly",
      variant_id: 22,
      cancelled: false,
      user_email: "buyer@example.com",
      card_last_four: "4242",
      urls: { customer_portal: "https://signed.example/secret" },
    }),
    item(11, {
      status: "active",
      created_at: "2026-10-05T09:00:00Z",
      product_name: "Monthly",
      variant_id: 21,
      cancelled: false,
    }),
    item(10, {
      status: "expired",
      created_at: "2026-07-01T09:00:00Z",
      ends_at: "2026-10-25T09:00:00Z",
      product_name: "Monthly",
      variant_id: 21,
    }),
  ],
  "subscription-invoices": [
    item(41, {
      billing_reason: "renewal",
      status: "paid",
      created_at: "2026-11-05T09:00:00Z",
      total_usd: 699,
      refunded_amount_usd: 0,
    }),
    item(40, {
      billing_reason: "initial",
      status: "paid",
      created_at: "2026-11-02T09:00:00Z",
      total_usd: 5999,
    }),
  ],
  customers: [
    item(5, { created_at: "2026-11-02T09:00:00Z", country: "UY" }),
    item(4, { created_at: "2026-10-20T09:00:00Z", country: "IN" }),
    item(3, { created_at: "2026-01-01T09:00:00Z", country: "US" }),
  ],
  variants: [
    item(21, { product_id: 1, price: 699, interval: "month", interval_count: 1 }),
    item(22, { product_id: 2, price: 5999, interval: "year", interval_count: 1 }),
  ],
};

function lemonFetch(calls) {
  return async (url, init) => {
    calls.push({ url: new URL(url), init });
    const resource = new URL(url).pathname.replace(/^\/v1\//, "");
    return Response.json(page(fixtures[resource] ?? []));
  };
}

test("date ranges default to 30 days and reject bad input", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  const range = resolveDateRange(undefined, undefined, now);
  assert.equal(range.to, "2026-11-10");
  assert.equal(range.from, "2026-10-11");
  assert.throws(() => resolveDateRange("2026-11-10", "2026-11-01"), /on or before/);
  assert.throws(() => resolveDateRange("2020-01-01", "2026-01-01"), /two years/);
  assert.throws(() => resolveDateRange("yesterday"), /YYYY-MM-DD/);
});

test("connection test lists stores with GET, bearer auth and JSON:API accept", async () => {
  const calls = [];
  const result = await withFetch(lemonFetch(calls), () =>
    testLemonSqueezyConnection("secret-key"),
  );
  assert.deepEqual(result, { storeCount: 1, storeNames: ["CleanCut Video"] });
  assert.equal(calls[0].url.href.startsWith("https://api.lemonsqueezy.com/v1/stores"), true);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.Authorization, "Bearer secret-key");
  assert.equal(calls[0].init.headers.Accept, "application/vnd.api+json");
});

test("sales summary aggregates orders, renewals, subscriptions and customers", async () => {
  const calls = [];
  const summary = await withFetch(lemonFetch(calls), () =>
    lemonSqueezySalesSummary("secret-key", { from: "2026-10-15", to: "2026-11-10" }),
  );
  assert.ok(calls.every(({ init }) => init.method === "GET"));
  assert.deepEqual(summary.range, { from: "2026-10-15", to: "2026-11-10" });
  assert.equal(summary.orders.count, 2);
  assert.deepEqual(summary.orders.byStatus, { paid: 1, refunded: 1 });
  assert.equal(summary.orders.grossUsd, 66.98);
  assert.equal(summary.orders.refundedUsd, 6.99);
  assert.equal(summary.orders.netOfRefundsUsd, 59.99);
  assert.deepEqual(summary.renewals, { count: 1, netUsd: 6.99 });
  assert.deepEqual(summary.subscriptions.byStatus, { active: 2, expired: 1 });
  assert.equal(summary.subscriptions.newInRange, 1);
  assert.equal(summary.subscriptions.endedInRange, 1);
  assert.equal(summary.subscriptions.estimatedMrrUsd, 11.99);
  assert.deepEqual(summary.newCustomers, { count: 2, byCountry: { UY: 1, IN: 1 } });
  assert.equal(summary.stores[0].lifetimeSales, 9);
  assert.doesNotMatch(JSON.stringify(summary), /@example\.com|Buyer Person|4242|signed\.example/);
});

test("order and subscription lists omit personal data", async () => {
  const calls = [];
  const orders = await withFetch(lemonFetch(calls), () =>
    listLemonSqueezyOrders("secret-key", { from: "2026-10-01", to: "2026-11-10", status: "paid" }),
  );
  assert.equal(orders.total, 2);
  assert.deepEqual(orders.orders.map(({ id }) => id), ["30", "28"]);
  assert.equal(calls[0].url.searchParams.has("filter[status]"), false);
  const subscriptions = await withFetch(lemonFetch(calls), () =>
    listLemonSqueezySubscriptions("secret-key", { status: "active", limit: 2 }),
  );
  assert.equal(subscriptions.subscriptions.length, 2);
  assert.equal(calls.at(-1).url.searchParams.get("filter[status]"), "active");
  assert.doesNotMatch(
    JSON.stringify([orders, subscriptions]),
    /@example\.com|Buyer Person|4242|signed\.example/,
  );
});

test("customer lookup needs an exact email and filters by it", async () => {
  await assert.rejects(
    findLemonSqueezyCustomer("secret-key", { email: "buyer" }),
    /exact email/,
  );
  const calls = [];
  await withFetch(lemonFetch(calls), () =>
    findLemonSqueezyCustomer("secret-key", { email: "buyer@example.com" }),
  );
  const filters = calls.map(({ url }) => [
    url.pathname,
    url.searchParams.get("filter[email]") ?? url.searchParams.get("filter[user_email]"),
  ]);
  assert.deepEqual(filters.sort(), [
    ["/v1/customers", "buyer@example.com"],
    ["/v1/orders", "buyer@example.com"],
    ["/v1/subscriptions", "buyer@example.com"],
  ]);
});

test("Lemon Squeezy is wired as a read-only, agent-scoped integration", async () => {
  const [catalog, service, mcp, route, runner, policy, toolCatalog, records] =
    await Promise.all([
      read("lib/integrations/catalog.ts"),
      read("lib/integrations/service.ts"),
      read("lib/integrations/mcp-server.ts"),
      read("app/api/integrations/[id]/mcp/route.ts"),
      read("lib/runner.ts"),
      read("lib/autonomy/tool-policy.ts"),
      read("lib/agent-tool-catalog.ts"),
      read("lib/repositories/integration-records.ts"),
    ]);
  for (const key of [
    "sales_summary",
    "list_orders",
    "list_subscriptions",
    "list_products",
    "find_customer",
  ]) {
    assert.match(catalog, new RegExp(`key: "${key}"`));
    assert.match(mcp, new RegExp(`allowed\\.has\\("${key}"\\)`));
  }
  assert.match(catalog, /provider: "lemonsqueezy"/);
  assert.match(service, /export async function saveLemonSqueezyIntegration/);
  assert.match(service, /name: "work_lemonsqueezy"/);
  assert.match(route, /handleLemonSqueezyMcpRequest\(request, id, agentId\)/);
  assert.match(runner, /LEMONSQUEEZY_AGENT_PROMPT/);
  assert.match(policy, /"work_lemonsqueezy"/);
  assert.match(toolCatalog, /return "work_lemonsqueezy"/);
  assert.match(records, /LEMONSQUEEZY_TOOLS/);
  const client = await read("lib/integrations/lemonsqueezy.ts");
  assert.doesNotMatch(client, /method: "(POST|PATCH|DELETE|PUT)"/);
});
