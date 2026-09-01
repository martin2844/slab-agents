# Google Analytics and Search Console

Slab can expose Google Analytics 4 and Google Search Console as native,
read-only tools. OAuth credentials and refresh tokens remain encrypted in the
control plane; agents receive only a short-lived, run-scoped MCP credential.

## Google Cloud setup

Create or select a Google Cloud project, then configure an OAuth 2.0 Web
application. Add the exact callback shown by Slab:

```text
https://your-slab-host/api/integrations/google-data/callback
```

For Google Analytics, enable:

- Google Analytics Data API
- Google Analytics Admin API

For Search Console, enable:

- Search Console API

If the OAuth consent screen is in testing mode, add every Google account that
will connect Slab as a test user. The connecting account must already have
access to the relevant GA4 properties or Search Console sites.

## Connect and assign

1. Open **Integrations**.
2. Choose **Google Analytics** or **Google Search Console**.
3. Enter the OAuth client ID and secret.
4. Copy the displayed callback into the Google OAuth application.
5. Select the tools each agent may use and save.
6. Choose **Connect Google** and complete consent.
7. Use **Test** from the active integration row.

Changes to assignments or integration configuration apply to the next run.
An active run keeps the exact integration version and tool allowlist captured
when it started.

## Agent tools

Google Analytics:

- `google_analytics_list_properties`
- `google_analytics_search_metadata`
- `google_analytics_run_report`
- `google_analytics_run_realtime_report`

Search Console:

- `search_console_list_sites`
- `search_console_query_performance`
- `search_console_list_sitemaps`
- `search_console_inspect_url`

All eight tools explicitly declare read-only, non-destructive, idempotent, and
open-world MCP annotations. Queries have timeouts, response limits, concurrency
limits, and bounded row counts.

## Security model

- OAuth uses authorization code flow with PKCE and a single-use state.
- Only `analytics.readonly` or `webmasters.readonly` is requested, plus OpenID
  email solely to identify the connected account.
- Client secrets, access tokens, and refresh tokens are encrypted server-side.
- Secrets are not returned by integration APIs or placed in prompts, run
  events, tool schemas, profiling, or capability snapshots.
- The MCP endpoint authenticates a random run credential stored only as a
  hash, verifies the run is active, and enforces the captured tool allowlist.
- Configuration version changes invalidate the old run capability instead of
  silently serving a new definition.
