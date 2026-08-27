# Slab Agent Workspace

A local, single-user control plane for shared work between humans and software
agents running through Codex or the experimental Claude Agent SDK adapter.

```text
Slab       = what needs to be done
Slab Docs  = what the company knows
Next.js    = who acts and when
Runner     = how an agent executes
```

The browser only communicates with Next.js. Slab MCP, Slab Docs MCP, SQLite, and Runner credentials are server-side concerns.

## Requirements

- Node.js 22+
- A Slab MCP endpoint
- A Slab Docs MCP endpoint
- Slab Runner bound to loopback when using agent chat or automations

## Configuration

The existing `.env` keys are used as initial server-side defaults:

```dotenv
TRACKER_API_KEY=...
DOCS_API_KEY=...

# Optional overrides
WORK_MCP_URL=http://127.0.0.1:6969/mcp
DOCS_MCP_URL=http://127.0.0.1:6980/mcp
RUNNER_URL=http://127.0.0.1:6990
SLAB_WORKSPACE_DB=.data/slab-workspace.db

# Optional Email integration (admin key stays server-side)
SLAB_EMAIL_ADMIN_KEY=...
```

URLs and replacement credentials can also be saved from Settings. Stored credentials are never returned by the API; the browser receives only `*ApiKeyConfigured` booleans.

## Runtime choice

Settings → Runtime lists the adapters registered by Slab Runner. Codex keeps
its existing Runner-owned ChatGPT authentication. Claude uses an Anthropic API
key entered through a write-only password field and encrypted in the control
plane database; API and page responses expose only configured/health metadata.
Testing Claude performs bounded server-side model discovery. Agents select a
runtime plus a discovered model or the workspace default, and each Run persists
the effective runtime/model before entering the queue. Changing an Agent does
not rewrite queued or historical Runs, and there is no silent provider
fallback.

The same Runtime settings page owns hard Run and Workspace budgets. Admission
reserves the maximum configured Run cost atomically after FIFO and Work
preflight, before Runner starts. Daily and monthly windows use UTC; Agent
overrides may only tighten the Workspace ceiling. Usage observations reconcile
idempotently against the Run's immutable pricing snapshot and an observed
ceiling cancels the active Runner execution. Claude receives the SDK's native
cost limit; its advisory `taskBudget` is not treated as a hard token limit, so
Claude Runs with a configured hard token ceiling fail closed before runtime.
Codex subscription Runs can use observed token ceilings, but USD limits require
an operator-configured model price—Slab never invents a dollar cost for
subscription usage.

Native enforcement is negotiated from the Runner runtime catalog. If a rolling
upgrade leaves Runner without the required budget capability, the control plane
fails the limited Run before creating a new Runner execution.

The private Runner request carries the selected Claude credential only for that
Run. Runner exchanges it for a short-lived loopback surrogate before the Claude
SDK child starts, keeping the real provider key out of the model context,
runtime environment, MCP definitions, events, and profiling.

## Agent tool policy

Each agent can carry a versioned policy for every assigned MCP server. Policies
use three execution modes: `approve` runs without an operator pause, `prompt`
uses Runner's approval lifecycle, and `deny` removes or rejects the tool. The
control plane translates the product labels Allow, Ask, and No access into
those runtime modes.

The effective server policies are persisted in `run_tool_policy_snapshots`
before Runner creation. Retries reuse that immutable snapshot, and a capability
added after the run started is not hot-plugged. Existing agents without saved
policies retain the legacy guarded/full-access behavior. Connector policy is a
separate safety ceiling: an agent-level Allow cannot weaken an Email or
Calendar write that is configured to require approval. Run-scoped custom and
Calendar MCP gateways also omit tools denied by the captured policy.

The authenticated control plane exposes the current policies at
`GET /api/agents/:id/tool-policies` and updates one server atomically with
`PUT /api/agents/:id/tool-policies`. Updates require `expectedVersion`; a stale
editor receives `VERSION_CONFLICT`. Changes apply only to future runs.

## Email integration

Email is managed as an optional workspace capability from Settings. `slab-agents` uses the `slab-email` admin
API only from the Node.js runtime. Mailbox credentials and Gmail refresh tokens
are stored by `slab-email`, never in the control-plane database. Each agent gets
its own remote access profile and one scoped connector token.

SQLite stores only profile and token metadata (`id`, prefix, timestamps). The
one-time raw connector token is encrypted in a mode-0600 server-side vault under
`.data/email-connector-tokens`; it is decrypted only while building the MCP
capability snapshot for a run and is never returned to React or included in an
LLM prompt. Configure `SLAB_EMAIL_ADMIN_KEY` in the server environment before
using account/profile administration.

Email send policy is enforced independently of the connector:

- `disabled` omits send permission from the remote profile;
- `approval required` exposes sending but forces a Runner approval for
  `email_send` and `email_reply`;
- `autonomous` uses the scoped profile without an additional send approval.

Email automations consume the metadata-only inbound event feed from
`slab-email`. The feed cursor and one dispatch intent per
`(automation, inbound event)` are committed atomically before a run starts, so
restarts neither lose the cursor nor create duplicate runs. An automation only
matches events discovered after it was created. Its agent must have read access
to the selected account and must not have `email_get_message` set to No access.
The generated task identifies the account and message, instructs the agent to
fetch the full message through its scoped Email tools, and treats message
content as untrusted external input.

## Calendar integrations

Calendar is another optional workspace capability managed directly by
`slab-agents`. Supported providers are Google Calendar, Microsoft 365,
CalDAV, Cal.com, and private shared ICS feeds. Proton Calendar is supported as
a read-only shared ICS source because Proton does not currently expose CalDAV.

Provider credentials are encrypted in the control plane and never returned to
React or sent to Runner. Each run receives an opaque token for a run-scoped
Slab Agents MCP endpoint. Agent assignment, the integration version, allowed
tools, and write policy are snapshotted at run start.

Calendar writes use the existing approval lifecycle:

- `disabled` exposes read tools only;
- `approval required` is the default and prompts for create/update/cancel;
- `autonomous` permits the assigned agent to write without that prompt.

See [Calendar integrations](docs/calendar-integrations.md) for provider setup,
OAuth callback paths, security boundaries, tool contracts, and limitations.

## Operator Packs

Operator Packs provide inspectable, versioned operating configurations for
Founder Ops, Sales Ops, and Engineering Ops. The UI previews every Agent,
instruction, quick action, Automation, starter Doc, capability requirement, and
permission implication before applying it. Reconciliation preserves user edits
by default, remote Docs are resumable, and disabling a pack never deletes Work
or historical data.

See [Operator Packs](docs/operator-packs.md) for the strict manifest contract,
installation lifecycle, import/export, synthetic acceptance, and security
boundary.

## Run locally

With `slab`, `slab-docs`, `slab-runner`, and `slab-agents` checked out as
sibling directories, start the complete local stack with one command:

```bash
npm run stack:dev
```

This reuses healthy Work and Docs instances when they already exist; otherwise
it starts them through Docker Compose on loopback. It then supervises Runner and
the Next.js control plane in the current terminal. Press `Ctrl+C` to stop the two
host processes; Docker services use their configured restart policy and remain
available.

To run only the control plane when its dependencies are already active:

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:3009](http://127.0.0.1:3009). Both development and
production scripts bind Next.js to loopback so the unauthenticated local
control plane is never exposed to the LAN.

For a production-mode local run:

```bash
npm run build
npm start
```

During active development, keep `npm run dev` running and use
`npm run build:check` for production verification. Development, verification,
and production use separate Next.js output directories so an open browser tab
cannot receive assets from a partially replaced build. Stop `npm start` before
running a new production `npm run build`.

Knex migrations run automatically before dev, build, and start.

## Database lifecycle

The workspace DB contains orchestration state only: agents, threads, messages, runs, run events, approvals, automations, settings, and Knex migration metadata. It does not mirror Slab issues or Slab Docs documents.

## Concurrency semantics

Work-triggered runs (`assignment`, `resumed`, `review_requested`, `blocked`,
and `mention`) and inbound Email runs enter the existing per-agent FIFO queue. Immediately after a
run reaches the queue head, the control plane re-reads its associated Work
item before contacting Runner. Stateful triggers that are no longer true are
persisted as `skipped`; they produce no runtime thread, model calls, agent tool
calls, or token usage. Mentions remain durable event-based triggers and are
invalidated only when their Work item no longer exists.

Slab issue mutations carry `expected_version` from the latest Work read. A
`VERSION_CONFLICT` is surfaced to the agent or UI instead of overwriting newer
state. Comments remain append-only and do not use the issue version guard.

The integration/MCP server set is a snapshot captured when each run starts.
Approving a runtime action only resolves that pending action: it does not
hot-plug a new server and does not create a new run. Integration changes apply
to the next run.

Runs persist execution semantics separately from agent identity:

- `trigger` records what initiated execution, such as chat, manual action,
  automation, inbound Email, assignment, or mention;
- `mode` records how the run should operate, such as chat, task, review,
  assignment, or another Work-item event;
- `issue_key` is present only for deliberately Work-scoped runs;
- `run_instructions` stores the policy for that individual execution.

Manual and scheduled automations share the same execution path and automation
mode. Runs for one agent are serialized through the durable SQLite-backed FIFO;
different agents may execute concurrently. Work event idempotency remains
persisted in SQLite.

Inbound Email automations use the same task/review modes, but require one
durably captured Email event and cannot be started manually without message
context. Pending Email occurrences are revalidated against the automation,
agent, mailbox access, and granular Email tool policy immediately before the
run is created.

```bash
npm run migrate:latest
npm run migrate:make -- add_something
npm run migrate:rollback
```

An optional COO development seed is available without affecting normal startup:

```bash
SLAB_SEED_EXAMPLE_AGENT=true npm run seed:run
```

## Runner HTTP contract

The workspace expects a loopback Runner with these endpoints.

### Health

```http
GET /health
```

### Start or resume a run

```http
POST /runs
Content-Type: application/json
```

Runner acknowledges the run immediately with `202 Accepted`. Next.js then opens
the normalized event stream separately:

```http
GET /runs/:runId/events
Accept: text/event-stream
```

The request includes:

- `run_id`, `runtime`, and optional `model`;
- stable agent identity (`name`, `role`, `instructions`);
- `runtime_thread_id` when continuing a conversation;
- minimal recent context only when creating or rehydrating a runtime thread;
- server-side Work and Docs MCP configuration.

The Runner stream uses the normalized Slab protocol. Supported events include:

```text
run.started
thread.created        { runtimeThreadId }
assistant.delta       { delta }
assistant.completed   { message }
tool.started
tool.completed
approval.required     { approvalId, command, ... }
approval.resolved
usage.updated
run.completed
run.failed            { error }
run.cancelled
```

Token deltas are streamed but not persisted. Significant events and completed assistant messages are persisted. If a stored runtime thread returns a 404/thread-not-found error, the workspace clears that mapping and retries with recent product conversation context.

### Resolve an approval

```http
POST /runs/:runId/approvals/:approvalId
Content-Type: application/json

{ "decision": "approve" | "deny" }
```

## Quality checks

```bash
npm run typecheck
npm run lint
npm test
npm run build:check
```

## MVP limits

- Automations run only while the Next.js process is alive.
- No multi-tenancy, organization RBAC, or agent-to-agent chat.
- Runner is restricted to `localhost`, `127.0.0.1`, or `::1`.
