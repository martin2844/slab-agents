import "server-only";

/**
 * Read-only Lemon Squeezy client. Every function issues GET requests only, and
 * list results drop customer names, emails, card details and signed URLs.
 * Only `findLemonSqueezyCustomer`, which needs an exact email, returns a
 * customer's name and email.
 */

const API_BASE = "https://api.lemonsqueezy.com/v1";
const REQUEST_TIMEOUT_MS = 15_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const DAY_MS = 86_400_000;

type JsonRecord = Record<string, unknown>;
type Resource = { id: string; attributes: JsonRecord };
type Query = Record<string, string | number | undefined>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorDetail(payload: unknown, status: number) {
  if (isRecord(payload) && Array.isArray(payload.errors)) {
    const first = payload.errors.find(isRecord);
    const detail = first?.detail ?? first?.title;
    if (typeof detail === "string" && detail) return detail;
  }
  if (status === 401) return "Lemon Squeezy rejected the API key.";
  return `Lemon Squeezy returned ${status}.`;
}

async function request(apiKey: string, pathname: string, query: Query = {}) {
  const url = new URL(`${API_BASE}${pathname}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/vnd.api+json",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(errorDetail(payload, response.status));
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Lemon Squeezy did not respond within 15 seconds.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function resources(payload: unknown): Resource[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
  return payload.data
    .filter(isRecord)
    .map((item) => ({
      id: String(item.id ?? ""),
      attributes: isRecord(item.attributes) ? item.attributes : {},
    }));
}

function lastPage(payload: unknown) {
  const page =
    isRecord(payload) && isRecord(payload.meta) && isRecord(payload.meta.page)
      ? payload.meta.page
      : null;
  return typeof page?.lastPage === "number" ? page.lastPage : 1;
}

/** Lemon Squeezy lists newest first; `stopBefore` ends paging once items predate it. */
async function listAll(
  apiKey: string,
  resource: string,
  filters: Query,
  options: { maxItems?: number; stopBefore?: number } = {},
) {
  const items: Resource[] = [];
  let truncated = false;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const payload = await request(apiKey, `/${resource}`, {
      ...filters,
      "page[size]": PAGE_SIZE,
      "page[number]": page,
    });
    const batch = resources(payload);
    items.push(...batch);
    const oldest = batch.at(-1);
    const reachedStop =
      options.stopBefore !== undefined &&
      oldest !== undefined &&
      time(oldest.attributes.created_at) < options.stopBefore;
    if (options.maxItems !== undefined && items.length >= options.maxItems) {
      truncated = items.length > options.maxItems || page < lastPage(payload);
      return { items: items.slice(0, options.maxItems), truncated };
    }
    if (reachedStop || page >= lastPage(payload)) return { items, truncated };
    if (page === MAX_PAGES) truncated = true;
  }
  return { items, truncated };
}

function time(value: unknown) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function usd(cents: unknown) {
  const value = typeof cents === "number" ? cents : Number(cents ?? 0);
  return Number.isFinite(value) ? Math.round(value) / 100 : 0;
}

function text(value: unknown) {
  return typeof value === "string" ? value : null;
}

function firstOrderItem(attributes: JsonRecord) {
  return isRecord(attributes.first_order_item) ? attributes.first_order_item : {};
}

function storeFilter(storeId?: string) {
  return storeId ? { "filter[store_id]": storeId } : {};
}

export type DateRange = { from: string; to: string; fromMs: number; toMs: number };

/** Inclusive date range; defaults to the last 30 days. Dates are YYYY-MM-DD (UTC). */
export function resolveDateRange(from?: string, to?: string, now = Date.now()): DateRange {
  const toMs = to ? Date.parse(`${to}T23:59:59.999Z`) : now;
  const fromMs = from ? Date.parse(`${from}T00:00:00.000Z`) : toMs - 30 * DAY_MS;
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    throw new Error("Dates must use the YYYY-MM-DD format.");
  }
  if (fromMs > toMs) throw new Error("`from` must be on or before `to`.");
  if (toMs - fromMs > 731 * DAY_MS) throw new Error("Use a range of two years or less.");
  return {
    from: new Date(fromMs).toISOString().slice(0, 10),
    to: new Date(toMs).toISOString().slice(0, 10),
    fromMs,
    toMs,
  };
}

function inRange(value: unknown, range: DateRange) {
  const at = time(value);
  return at >= range.fromMs && at <= range.toMs;
}

/** Monday (UTC) of the week containing the timestamp. */
function weekStart(value: unknown) {
  const date = new Date(time(value));
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

function increment(map: Record<string, number>, key: string, by = 1) {
  map[key] = Math.round(((map[key] ?? 0) + by) * 100) / 100;
}

export function toOrderSummary(order: Resource) {
  const a = order.attributes;
  const item = firstOrderItem(a);
  return {
    id: order.id,
    orderNumber: a.order_number ?? null,
    createdAt: text(a.created_at),
    status: text(a.status),
    product: text(item.product_name),
    variant: text(item.variant_name),
    productId: item.product_id ?? null,
    totalUsd: usd(a.total_usd),
    taxUsd: usd(a.tax_usd),
    discountUsd: usd(a.discount_total_usd),
    refundedUsd: usd(a.refunded_amount_usd),
    currency: text(a.currency),
    customerId: a.customer_id ?? null,
    testMode: a.test_mode === true,
  };
}

export function toSubscriptionSummary(subscription: Resource) {
  const a = subscription.attributes;
  return {
    id: subscription.id,
    createdAt: text(a.created_at),
    status: text(a.status),
    product: text(a.product_name),
    variant: text(a.variant_name),
    productId: a.product_id ?? null,
    variantId: a.variant_id ?? null,
    cancelled: a.cancelled === true,
    paused: a.pause !== null && a.pause !== undefined,
    renewsAt: text(a.renews_at),
    endsAt: text(a.ends_at),
    trialEndsAt: text(a.trial_ends_at),
    paymentProcessor: text(a.payment_processor),
    customerId: a.customer_id ?? null,
    orderId: a.order_id ?? null,
    testMode: a.test_mode === true,
  };
}

const REVENUE_STATUSES = new Set(["paid", "refunded", "partial_refund"]);
const LIVE_SUBSCRIPTION_STATUSES = new Set(["active", "on_trial", "past_due"]);

/** Monthly recurring revenue contribution of one subscription, in USD. */
function monthlyValue(variant: JsonRecord | undefined) {
  if (!variant) return 0;
  const price = usd(variant.price);
  const count = Number(variant.interval_count ?? 1) || 1;
  switch (variant.interval) {
    case "day":
      return (price * 30) / count;
    case "week":
      return (price * 52) / 12 / count;
    case "month":
      return price / count;
    case "year":
      return price / 12 / count;
    default:
      return 0;
  }
}

export async function listLemonSqueezyStores(apiKey: string) {
  const payload = await request(apiKey, "/stores", { "page[size]": PAGE_SIZE });
  return resources(payload).map(({ id, attributes: a }) => ({
    id,
    name: text(a.name),
    domain: text(a.domain),
    url: text(a.url),
    currency: text(a.currency),
    plan: text(a.plan),
    totalSales: a.total_sales ?? null,
    totalRevenueUsd: usd(a.total_revenue),
    thirtyDaySales: a.thirty_day_sales ?? null,
    thirtyDayRevenueUsd: usd(a.thirty_day_revenue),
    createdAt: text(a.created_at),
  }));
}

export async function testLemonSqueezyConnection(apiKey: string) {
  const stores = await listLemonSqueezyStores(apiKey);
  return {
    storeCount: stores.length,
    storeNames: stores.map((store) => store.name).filter(Boolean) as string[],
  };
}

export async function listLemonSqueezyProducts(
  apiKey: string,
  input: { storeId?: string } = {},
) {
  const [products, variants] = await Promise.all([
    listAll(apiKey, "products", storeFilter(input.storeId)),
    listAll(apiKey, "variants", {}),
  ]);
  return products.items.map(({ id, attributes: a }) => ({
    id,
    storeId: a.store_id ?? null,
    name: text(a.name),
    status: text(a.status),
    price: text(a.price_formatted),
    buyNowUrl: text(a.buy_now_url),
    createdAt: text(a.created_at),
    testMode: a.test_mode === true,
    variants: variants.items
      .filter((variant) => String(variant.attributes.product_id) === id)
      .map(({ id: variantId, attributes: v }) => ({
        id: variantId,
        name: text(v.name),
        status: text(v.status),
        priceUsd: usd(v.price),
        isSubscription: v.is_subscription === true,
        interval: text(v.interval),
        intervalCount: v.interval_count ?? null,
        hasFreeTrial: v.has_free_trial === true,
      })),
  }));
}

export async function listLemonSqueezyOrders(
  apiKey: string,
  input: { storeId?: string; status?: string; from?: string; to?: string; limit?: number },
) {
  const range = resolveDateRange(input.from, input.to);
  const limit = Math.max(1, Math.min(100, input.limit ?? 50));
  const { items, truncated } = await listAll(
    apiKey,
    "orders",
    storeFilter(input.storeId),
    { stopBefore: range.fromMs },
  );
  const orders = items
    .filter((order) => inRange(order.attributes.created_at, range))
    .filter((order) => !input.status || order.attributes.status === input.status)
    .map(toOrderSummary);
  return {
    range: { from: range.from, to: range.to },
    total: orders.length,
    truncated: truncated || orders.length > limit,
    orders: orders.slice(0, limit),
  };
}

export async function listLemonSqueezySubscriptions(
  apiKey: string,
  input: { storeId?: string; status?: string; limit?: number },
) {
  const limit = Math.max(1, Math.min(100, input.limit ?? 50));
  const { items, truncated } = await listAll(
    apiKey,
    "subscriptions",
    { ...storeFilter(input.storeId), "filter[status]": input.status },
    { maxItems: limit },
  );
  return {
    total: items.length,
    truncated,
    subscriptions: items.map(toSubscriptionSummary),
  };
}

export async function lemonSqueezySalesSummary(
  apiKey: string,
  input: { storeId?: string; from?: string; to?: string },
) {
  const range = resolveDateRange(input.from, input.to);
  const filter = storeFilter(input.storeId);
  const [stores, orders, subscriptions, invoices, customers, variants] =
    await Promise.all([
      listLemonSqueezyStores(apiKey),
      listAll(apiKey, "orders", filter, { stopBefore: range.fromMs }),
      listAll(apiKey, "subscriptions", filter),
      listAll(apiKey, "subscription-invoices", filter, { stopBefore: range.fromMs }),
      listAll(apiKey, "customers", filter, { stopBefore: range.fromMs }),
      listAll(apiKey, "variants", {}),
    ]);
  const variantById = new Map(variants.items.map((v) => [v.id, v.attributes]));

  const ordersInRange = orders.items.filter(
    (order) =>
      order.attributes.test_mode !== true &&
      inRange(order.attributes.created_at, range),
  );
  const ordersByStatus: Record<string, number> = {};
  const ordersByProduct: Record<string, number> = {};
  const revenueByProductUsd: Record<string, number> = {};
  const ordersByWeek: Record<string, number> = {};
  let grossUsd = 0;
  let taxUsd = 0;
  let refundedUsd = 0;
  for (const order of ordersInRange) {
    const summary = toOrderSummary(order);
    const status = summary.status ?? "unknown";
    const product = summary.product ?? "unknown";
    increment(ordersByStatus, status);
    increment(ordersByWeek, weekStart(summary.createdAt));
    if (!REVENUE_STATUSES.has(status)) continue;
    increment(ordersByProduct, product);
    increment(revenueByProductUsd, product, summary.totalUsd - summary.refundedUsd);
    grossUsd += summary.totalUsd;
    taxUsd += summary.taxUsd;
    refundedUsd += summary.refundedUsd;
  }

  const renewals = invoices.items.filter(
    ({ attributes: a }) =>
      a.test_mode !== true &&
      a.billing_reason === "renewal" &&
      a.status === "paid" &&
      inRange(a.created_at, range),
  );
  const renewalUsd = renewals.reduce(
    (sum, { attributes: a }) => sum + usd(a.total_usd) - usd(a.refunded_amount_usd),
    0,
  );

  const liveSubscriptions = subscriptions.items.filter(
    (s) => s.attributes.test_mode !== true,
  );
  const subscriptionsByStatus: Record<string, number> = {};
  const activeByProduct: Record<string, number> = {};
  let mrrUsd = 0;
  for (const subscription of liveSubscriptions) {
    const a = subscription.attributes;
    const status = text(a.status) ?? "unknown";
    increment(subscriptionsByStatus, status);
    if (!LIVE_SUBSCRIPTION_STATUSES.has(status)) continue;
    increment(activeByProduct, text(a.product_name) ?? "unknown");
    if (a.cancelled !== true) mrrUsd += monthlyValue(variantById.get(String(a.variant_id)));
  }
  const newSubscriptions = liveSubscriptions.filter((s) =>
    inRange(s.attributes.created_at, range),
  ).length;
  const endedSubscriptions = liveSubscriptions.filter(
    ({ attributes: a }) =>
      (a.status === "expired" || a.status === "cancelled") && inRange(a.ends_at, range),
  ).length;
  const cancellationsScheduled = liveSubscriptions.filter(
    ({ attributes: a }) => a.cancelled === true && LIVE_SUBSCRIPTION_STATUSES.has(String(a.status)),
  ).length;

  const newCustomersByCountry: Record<string, number> = {};
  const newCustomers = customers.items.filter(
    ({ attributes: a }) => a.test_mode !== true && inRange(a.created_at, range),
  );
  for (const { attributes: a } of newCustomers) {
    increment(newCustomersByCountry, text(a.country) || "unknown");
  }

  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    range: { from: range.from, to: range.to },
    stores: stores
      .filter((store) => !input.storeId || store.id === input.storeId)
      .map(({ id, name, totalSales, totalRevenueUsd, thirtyDaySales, thirtyDayRevenueUsd }) => ({
        id,
        name,
        lifetimeSales: totalSales,
        lifetimeRevenueUsd: totalRevenueUsd,
        last30DaysSales: thirtyDaySales,
        last30DaysRevenueUsd: thirtyDayRevenueUsd,
      })),
    orders: {
      count: ordersInRange.length,
      byStatus: ordersByStatus,
      byProduct: ordersByProduct,
      byWeekStarting: ordersByWeek,
      grossUsd: round(grossUsd),
      taxUsd: round(taxUsd),
      refundedUsd: round(refundedUsd),
      netOfRefundsUsd: round(grossUsd - refundedUsd),
      revenueByProductUsd,
    },
    renewals: { count: renewals.length, netUsd: round(renewalUsd) },
    subscriptions: {
      byStatus: subscriptionsByStatus,
      activeByProduct,
      newInRange: newSubscriptions,
      endedInRange: endedSubscriptions,
      activeWithCancellationScheduled: cancellationsScheduled,
      estimatedMrrUsd: round(mrrUsd),
    },
    newCustomers: { count: newCustomers.length, byCountry: newCustomersByCountry },
    notes: [
      "Amounts are USD from Lemon Squeezy, tax included where the store charges tax-inclusive prices; netOfRefundsUsd still includes tax.",
      "Orders are first purchases; subscription renewals are counted separately under renewals.",
      "estimatedMrrUsd counts active, on-trial and past-due subscriptions without a scheduled cancellation; yearly plans count as price/12.",
      "Test-mode records are excluded.",
      ...(orders.truncated || invoices.truncated || customers.truncated || subscriptions.truncated
        ? ["Some lists hit the paging limit; totals may be incomplete. Use a narrower range."]
        : []),
    ],
  };
}

export async function findLemonSqueezyCustomer(
  apiKey: string,
  input: { email: string; storeId?: string },
) {
  const email = input.email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Provide the customer's exact email address.");
  }
  const filter = storeFilter(input.storeId);
  const [customers, orders, subscriptions] = await Promise.all([
    listAll(apiKey, "customers", { ...filter, "filter[email]": email }, { maxItems: 10 }),
    listAll(apiKey, "orders", { ...filter, "filter[user_email]": email }, { maxItems: 50 }),
    listAll(apiKey, "subscriptions", { ...filter, "filter[user_email]": email }, { maxItems: 50 }),
  ]);
  return {
    found: customers.items.length > 0 || orders.items.length > 0,
    customers: customers.items.map(({ id, attributes: a }) => ({
      id,
      name: text(a.name),
      email: text(a.email),
      status: text(a.status),
      country: text(a.country),
      createdAt: text(a.created_at),
      totalRevenueUsd: usd(a.total_revenue_currency),
      mrrUsd: usd(a.mrr),
      testMode: a.test_mode === true,
    })),
    orders: orders.items.map(toOrderSummary),
    subscriptions: subscriptions.items.map(toSubscriptionSummary),
  };
}
