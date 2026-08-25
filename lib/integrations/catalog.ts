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

export const CALENDAR_AGENT_PROMPT = `Calendar access is available through scoped provider tools.

- Use calendar_list_calendars before assuming a calendar identifier, and use explicit bounded time ranges for event and availability queries.
- Treat event details and attendee information as private operational data; retrieve only what the current task needs.
- Before creating, updating, or cancelling an event, confirm the exact date, time, time zone, calendar, and attendees from available context.
- Calendar writes may require control-plane approval. Never claim an event was created, changed, or cancelled unless the tool confirms it.
- Never request, reveal, or infer OAuth tokens, passwords, API keys, or private calendar feed URLs.`;
