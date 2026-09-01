import type { IntegrationCatalogItem, IntegrationTool } from "@/lib/types";

export const POSTHOG_TOOLS: IntegrationTool[] = [
  {
    key: "list_projects",
    name: "List projects",
    description:
      "Discover the PostHog projects available to the connected account.",
    readOnly: true,
  },
  {
    key: "query_analytics",
    name: "Query analytics",
    description:
      "Run a read-only HogQL query against a selected PostHog project.",
    readOnly: true,
  },
];

export const GOOGLE_ANALYTICS_TOOLS: IntegrationTool[] = [
  {
    key: "google_analytics_list_properties",
    name: "List properties",
    description:
      "List the Google Analytics 4 accounts and properties available to this connection.",
    readOnly: true,
  },
  {
    key: "google_analytics_search_metadata",
    name: "Search metrics and dimensions",
    description:
      "Find supported standard and custom dimensions or metrics for one GA4 property.",
    readOnly: true,
  },
  {
    key: "google_analytics_run_report",
    name: "Run report",
    description:
      "Run a bounded historical GA4 report with explicit dates, dimensions, and metrics.",
    readOnly: true,
  },
  {
    key: "google_analytics_run_realtime_report",
    name: "Run realtime report",
    description:
      "Read bounded realtime activity from a GA4 property.",
    readOnly: true,
  },
];

export const GOOGLE_SEARCH_CONSOLE_TOOLS: IntegrationTool[] = [
  {
    key: "search_console_list_sites",
    name: "List sites",
    description:
      "List the Search Console properties available to this connection.",
    readOnly: true,
  },
  {
    key: "search_console_query_performance",
    name: "Query search performance",
    description:
      "Query bounded clicks, impressions, CTR, and position data for a site.",
    readOnly: true,
  },
  {
    key: "search_console_list_sitemaps",
    name: "List sitemaps",
    description: "List submitted sitemaps and their current processing state.",
    readOnly: true,
  },
  {
    key: "search_console_inspect_url",
    name: "Inspect URL",
    description:
      "Read Google's indexed status and inspection result for one URL.",
    readOnly: true,
  },
];

export const INTEGRATION_CATALOG: IntegrationCatalogItem[] = [
  {
    provider: "posthog",
    name: "PostHog",
    description:
      "Give agents controlled, read-only access to product analytics.",
    available: true,
    tools: POSTHOG_TOOLS,
  },
  {
    provider: "google_analytics",
    name: "Google Analytics",
    description:
      "Give agents read-only access to GA4 traffic, acquisition, and conversion data.",
    available: true,
    tools: GOOGLE_ANALYTICS_TOOLS,
  },
  {
    provider: "google_search_console",
    name: "Google Search Console",
    description:
      "Give agents read-only access to organic search performance and index status.",
    available: true,
    tools: GOOGLE_SEARCH_CONSOLE_TOOLS,
  },
  {
    provider: "custom_http",
    name: "Custom integration",
    description:
      "Connect an internal API or MCP server with a custom tool manifest.",
    available: true,
    tools: [],
  },
  {
    provider: "custom_mcp",
    name: "Custom MCP integration",
    description:
      "Connect an existing Streamable HTTP MCP server and expose its tools.",
    available: true,
    tools: [],
  },
];

export const EMAIL_AGENT_PROMPT = `Email is available through a scoped MCP server.

- Use email_list_accounts to discover only the accounts available to this agent.
- For email_send and email_reply, pass the exact sender address returned by the latest email_list_accounts call. Agent identity or signature text never overrides the connected sender.
- Use email_search and email_get_message to read relevant correspondence; avoid retrieving unrelated mail.
- Create drafts or send only when the corresponding tool is available.
- Sending may require a control-plane approval. Never claim a message was sent unless the tool confirms it.
- Never request, reveal, or infer mailbox credentials or connector tokens.`;

export const POSTHOG_AGENT_PROMPT = `PostHog analytics is available through a restricted, read-only MCP server.

- Start with posthog.list_projects when the project identifier is unknown.
- Use posthog.query_analytics for evidence-based product questions. Write bounded HogQL SELECT queries and include an explicit date range whenever time matters.
- Prefer aggregates over person-level rows. Do not request or expose unnecessary personal data.
- Never invent event names, properties, project identifiers, or results. If the schema is unknown, inspect it with a small query first.
- State the project, date range, filters, and important limitations when summarizing results.
- These tools cannot mutate PostHog.`;

export const GOOGLE_DATA_AGENT_PROMPT = `Google Analytics and Search Console may be available through scoped, read-only MCP servers.

- List available GA4 properties or Search Console sites before assuming an identifier.
- Use explicit, bounded date ranges and small row limits. State the property, range, dimensions, metrics, and important limitations in the answer.
- Search Analytics returns representative top rows rather than a guaranteed exhaustive export. Do not describe it as complete raw data.
- Use metadata search before inventing GA4 metric or dimension names.
- Retrieve only the operational data needed for the task and avoid unnecessary person-level dimensions.
- These tools cannot change Analytics or Search Console configuration, sites, sitemaps, or customer data.`;

export const CALENDAR_AGENT_PROMPT = `Calendar access is available through scoped provider tools.

- Use calendar_list_calendars before assuming a calendar identifier, and use explicit bounded time ranges for event and availability queries.
- Treat event details and attendee information as private operational data; retrieve only what the current task needs.
- Before creating, updating, or cancelling an event, confirm the exact date, time, time zone, calendar, and attendees from available context.
- Calendar writes may require control-plane approval. Never claim an event was created, changed, or cancelled unless the tool confirms it.
- Never request, reveal, or infer OAuth tokens, passwords, API keys, or private calendar feed URLs.`;
