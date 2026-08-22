# Calendar integrations implementation TODO

Status: implementation and Big Review complete; production rollout pending

## Product goal

Give agents scoped calendar capabilities without exposing provider credentials to the browser, prompts, tool schemas, run events, or profiling. Calendar remains optional and is managed by the existing Slab Agents control plane.

## Architecture decisions

- Calendar integrations live in `slab-agents`; no new daemon is introduced.
- Reuse the generic `integrations`, `agent_integration_tools`, and `run_integration_capabilities` persistence and capability-snapshot model.
- Each connected calendar account is an integration record with encrypted credentials and a versioned configuration.
- Every run gets an opaque, run-scoped MCP credential. Runtime requests resolve the run, agent, integration version, and allowed tools server-side.
- Provider credentials never enter runner configuration. The runner sees only the Slab Agents MCP URL and opaque run token.
- Reads are allowed only when assigned to the agent. Writes follow an integration policy: `disabled`, `approval_required`, or `autonomous`.
- Provider changes apply to the next run. Active runs fail closed on integration version drift.

## Providers

- [x] Google Calendar OAuth 2.0
- [x] Microsoft 365 / Outlook OAuth 2.0
- [x] Generic CalDAV
- [x] Cal.com API
- [x] Shared ICS URL (read-only)
- [x] Proton Calendar documented as shared-ICS-only until Proton exposes a supported API or CalDAV

## Semantic tool contract

- [x] `calendar_list_calendars`
- [x] `calendar_list_events`
- [x] `calendar_get_event`
- [x] `calendar_find_availability`
- [x] `calendar_create_event`
- [x] `calendar_update_event`
- [x] `calendar_cancel_event`

Tools are exposed only when the provider and assigned permission support them. Tool responses are bounded, normalized, and exclude provider tokens, response headers, cookies, and raw upstream diagnostics.

## Persistence

- [x] Extend integration provider/config DTOs for calendar providers
- [x] Add OAuth state storage with expiry and one-time consumption
- [x] Keep OAuth client secrets, refresh tokens, CalDAV passwords, API keys, and private ICS URLs encrypted
- [x] Store account metadata and public connection status only in client-facing DTOs
- [x] Preserve run history when integrations are disabled or deleted

## Server-side provider work

- [x] Shared normalized calendar domain and provider adapter interface
- [x] Strict time range, pagination, response-size, redirect, and timeout limits
- [x] Google authorization, callback, refresh, test, and event operations
- [x] Microsoft authorization, callback, refresh, test, and event operations
- [x] CalDAV discovery, event query, get, create/update/delete, and ETag handling
- [x] Cal.com booking read/create/reschedule/cancel mapping
- [x] ICS fetch and bounded event parsing; no writes
- [x] Structured provider errors with secret redaction

## Runtime and policy

- [x] Add calendar capability servers to the existing run bootstrap and profiler
- [x] Snapshot integration version and allowed tools at run start
- [x] Register correct MCP read-only/destructive/idempotent annotations
- [x] Map write tools to the existing runner approval mechanism
- [x] Default calendar write policy to `approval_required`

## UI

- [x] Settings → Calendar summary and management dialog
- [x] Provider chooser and setup forms
- [x] Google and Microsoft OAuth configuration/callback states
- [x] CalDAV, Cal.com, and Shared ICS setup/test/edit/disable/delete flows
- [x] Agent Capabilities assignment using existing integration controls
- [x] Clear display of account, provider, tools, agents, health, and write policy
- [x] Calendar setup and security documentation in How it works

## Verification

- [x] Repository/migration tests
- [x] OAuth state and callback tests
- [x] Provider adapter tests with mock upstreams
- [x] MCP authentication, scoping, snapshot, approval, and redaction tests
- [x] UI/API contract tests
- [x] Existing Work, Docs, Email, PostHog, and Custom Integration regression tests
- [x] Lint, typecheck, tests, production build, and `git diff --check`
- [x] Functional QA on Settings, Integrations, Agent Capabilities, and documentation
- [x] Big Review with verified findings fixed
- [ ] Push, production deployment, and live canary verification

## Explicit non-goals

- Syncing or copying entire calendars into SQLite
- A generic arbitrary HTTP client for agents
- Hot-plugging a provider into an active run
- Browser automation or private Proton API reverse engineering
- Automatic write access without an explicit per-integration policy
- A separate `slab-calendar` service
