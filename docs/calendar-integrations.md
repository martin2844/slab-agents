# Calendar integrations

Slab Agents can expose provider calendars to selected agents as semantic MCP
tools. Calendar is optional and runs inside the existing Next.js control plane;
it does not introduce another daemon.

## Supported providers

| Provider                | Authentication            | Read                                    | Write                      |
| ----------------------- | ------------------------- | --------------------------------------- | -------------------------- |
| Google Calendar         | OAuth 2.0 web application | calendars, events, free/busy            | create, update, cancel     |
| Microsoft 365 / Outlook | Microsoft Entra OAuth 2.0 | calendars, events, free/busy            | create, update, cancel     |
| CalDAV                  | username + app password   | calendars, events, derived busy periods | create, update, delete     |
| Cal.com                 | API key                   | bookings and derived busy periods       | create, reschedule, cancel |
| Shared ICS URL          | private feed URL          | events and derived busy periods         | not supported              |

Proton Calendar does not currently support CalDAV. Its supported connector is a
private shared ICS link and is therefore read-only. See Proton's official guides
for [sharing a calendar via link](https://proton.me/support/share-calendar-via-link)
and [CalDAV support](https://proton.me/support/subscribe-to-external-calendar#does-proton-calendar-support-caldav).

## Agent tools

Every connected account exposes a subset of the same stable contract:

```text
calendar_list_calendars
calendar_list_events
calendar_get_event
calendar_find_availability
calendar_create_event
calendar_update_event
calendar_cancel_event
```

An agent does not receive provider URLs, OAuth tokens, passwords, API keys,
private ICS links, cookies, response headers, or a generic HTTP client.

## Security boundary

- OAuth client secrets, refresh/access tokens, CalDAV passwords, Cal.com keys,
  and private ICS URLs are encrypted with the workspace master key.
- Client-facing integration DTOs expose only account metadata, health, policy,
  tool names, and assignment state.
- The runner receives a Slab Agents MCP URL and an opaque run-scoped token.
- Each runtime request resolves `run → agent → integration → version → tools`
  server-side.
- Connector configuration is versioned. Active runs fail closed if the version
  changes; new configuration applies to the next run.
- Provider redirects are not followed, time ranges are bounded to 366 days,
  availability is bounded to three sequential provider requests, responses are
  streamed into a 1 MB provider limit, MCP results are capped, and each account
  allows at most four concurrent tool calls.
- Provider error bodies are not returned to the model.

## Write policy

Each writable account has one policy:

```text
disabled
approval_required  (default)
autonomous
```

`disabled` removes create/update/cancel tools. `approval_required` maps write
tools to the existing runtime approval lifecycle. `autonomous` exposes them
without an approval prompt. A shared ICS account is always read-only.

## Google Calendar

1. In Google Cloud, enable **Google Calendar API**.
2. Configure Google Auth Platform branding and audience.
3. While the app is in Testing, add every connecting Google account under
   **Audience → Test users**.
4. Create an OAuth client of type **Web application**.
5. In Settings → Calendar, create a Google Calendar integration and copy its
   exact redirect URI:

   ```text
   https://<workspace-domain>/api/integrations/calendar/google/callback
   ```

6. Add that URI to the OAuth client's authorized redirect URIs.
7. Save the client ID and secret in Slab Agents, then select **Authorize
   account**.
8. Test the connection and assign the account to an agent.

Slab Agents requests the Calendar scope needed for event reads/writes and uses
Google's documented Calendar v3 resources and free/busy endpoint. See the
[Google Calendar API reference](https://developers.google.com/workspace/calendar/api/v3/reference).

## Microsoft 365 / Outlook

1. Create a Microsoft Entra App registration.
2. Add delegated permissions `User.Read`, `offline_access`, and
   `Calendars.ReadWrite`.
3. Create a client secret and copy its **value** immediately.
4. Add this Web redirect URI:

   ```text
   https://<workspace-domain>/api/integrations/calendar/microsoft/callback
   ```

5. Enter the client ID, secret, and tenant in Settings → Calendar.
6. Save, authorize, test, and assign the account.

Availability is derived from bounded `calendarView` queries for the connected
account or selected calendar IDs. This keeps the tool contract consistent for
personal and organization accounts. See Microsoft's
[calendarView reference](https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0).

## CalDAV

Use the exact calendar/account collection URL supplied by the provider. Prefer a
dedicated app password. Slab Agents validates that discovered calendar and
event URLs stay on the configured origin and underneath the configured path.

Examples include Nextcloud, Fastmail, iCloud, Radicale, and standards-compatible
servers. Provider-specific URL discovery is intentionally not guessed; use the
URL from that provider's CalDAV instructions.

## Cal.com

Use `https://api.cal.com` unless connecting a self-hosted Cal.com API. Create a
dedicated `cal_` API key. An event type ID is optional for reads but required by
the current create-booking tool. Listing uses Cal.com's bounded, cursor-based
bookings API and explicit date filters. See the official
[bookings API](https://cal.com/docs/api-reference/v2/bookings/get-all-bookings)
and [create booking contract](https://cal.com/docs/api-reference/v2/bookings/create-a-booking).

## Shared ICS and Proton Calendar

Treat the feed URL as a secret: anyone who holds a full-view link may read event
details. In Proton Calendar web:

1. Open Settings → All settings → Calendars.
2. Select the calendar.
3. Under **Share with anyone**, create a limited- or full-view link.
4. Paste the URL into **Shared calendar URL** in Slab Agents.
5. Test and assign it to an agent.

ICS feeds are fetched on demand, bounded to 1 MB, and never persisted as a copy
of the calendar. Recurrence expansion is not performed in this MVP, so
availability fails explicitly when recurrence data prevents a complete answer.

## Capability lifecycle

```text
Settings saves encrypted provider configuration
  ↓
Agent assignment selects the account tools
  ↓
Run start persists integration version + allowlist
  ↓
Runner receives Slab Agents MCP URL + opaque run token
  ↓
Agent calls semantic calendar tool
  ↓
Slab Agents validates run, agent, version, policy, and tool
  ↓
Provider adapter performs the bounded request
  ↓
Normalized result enters the existing run profiler
```

Changes made during a run apply to the next run. Calendar does not hot-plug
tools into a live Codex execution.

## Current limitations

- Proton Calendar is read-only through a shared ICS link.
- Shared ICS and unexpanded CalDAV recurrence rules are not expanded;
  availability fails closed when completeness cannot be guaranteed.
- Cal.com support models bookings, not every Cal.com resource.
- CalDAV servers must provide a concrete usable collection URL.
- There are no calendar webhooks or background sync; agents query on demand.
