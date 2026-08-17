# Slab Agent Workspace

A local, single-user control plane for shared work between humans and Codex agents.

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
```

URLs and replacement credentials can also be saved from Settings. Stored credentials are never returned by the API; the browser receives only `*ApiKeyConfigured` booleans.

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
and `mention`) enter the existing per-agent FIFO queue. Immediately after a
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
  automation, assignment, or mention;
- `mode` records how the run should operate, such as chat, task, review,
  assignment, or another Work-item event;
- `issue_key` is present only for deliberately Work-scoped runs;
- `run_instructions` stores the policy for that individual execution.

Manual and scheduled automations share the same execution path and automation
mode. Runs for one agent are serialized in a local in-memory FIFO; different
agents may execute concurrently. Work event idempotency remains persisted in
SQLite.

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
- No login, multi-tenancy, RBAC, durable jobs, missed-job recovery, or agent-to-agent chat.
- Runner is restricted to `localhost`, `127.0.0.1`, or `::1`.
