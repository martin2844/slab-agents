# Email Automations and Tool Control Plane

This document is the implementation and operating contract for inbound Email
automations and per-agent tool permissions in Slab Agents.

## Product behavior

An Email automation binds one enabled, readable `slab-email` account to an
ordered workflow of one to eight agent steps. A workflow can filter incoming
mail by recipient, exact sender, sender domain, and subject text. Each inbound
message discovered after the automation was created produces at most one
durable workflow execution. Historical mailbox messages do not backfill a newly
created automation.

Every step starts its own Run and fresh runtime thread. The control plane passes
the previous step's bounded assistant output to the next step; agents do not
share an implicit Codex thread or scratchpad. The Run prompt contains bounded
message metadata and instructs the agent to fetch the complete message with
`email_get_message`. Email metadata, message bodies, and handoff output are
untrusted input; they cannot change the workflow, agent instructions, or
effective tool permissions.

## Workflow actions

Steps execute in the configured order:

| Action           | Purpose                                                     | Email writes |
| ---------------- | ----------------------------------------------------------- | ------------ |
| Analyze          | Inspect the message and produce evidence or a decision.      | Denied       |
| Draft reply      | Produce send-ready subject/body for a later reviewer.        | Denied       |
| Review and reply | Validate the handoff and reply in the original email thread. | Policy-bound |

`Review and reply` is optional, may appear at most once, and must be the final
step. It uses `email_reply`, never a new-message `email_send`, so the outbound
message remains attached to the inbound conversation. The workflow completes
that step only after Runner records a successful reply receipt for the exact
triggering account and message. A run-scoped connector constraint also rejects
any `email_reply` whose account or message differs from that trigger before the
mail provider is called. Analyze and Draft steps receive explicit run-scoped
denials for `email_send`, `email_reply`, and `email_create_draft`, even if their
agents normally have broader Email access.

Agent review and operator approval are different controls. A review step decides
whether the proposed response is correct. If its agent's Email send policy is
`approval_required`, the subsequent `email_reply` still pauses in Runs for a
human approval. With `autonomous`, it proceeds without that extra pause. With
`disabled`, the workflow cannot be enabled with a reply step.

Editing a workflow requires the version most recently read and increments its
definition version atomically. A stale editor receives a conflict instead of
overwriting newer changes. An execution snapshots the complete definition when
it starts; active executions keep that version, while the next inbound message
uses the new one. Only one execution for a given automation and email
conversation can be active at once. Later messages in the same thread wait
until the current execution reaches a terminal state.
IMAP/Proton events use the root RFC message identity (or a deterministic,
RFC-safe fallback) so the first message and later replies share this key.

## Permission modes

Every available MCP action has one agent-level mode:

| Product label | Runtime mode | Behavior                                                                     |
| ------------- | ------------ | ---------------------------------------------------------------------------- |
| No access     | `deny`       | Omit the tool where the runtime supports filtering and deny attempted calls. |
| Ask           | `prompt`     | Pause the Run and create an operator approval.                               |
| Allow         | `approve`    | Execute without an additional Slab approval.                                 |

The effective mode is the stricter of agent policy and connector policy. An
agent-level Allow cannot weaken an Email or Calendar connector configured to
require approval. Policies are copied into an immutable snapshot when a Run
reaches Runner. An edit therefore affects any Run that has not captured that
snapshot yet, including queued and pre-Runner setup. Once captured, active
Runner execution and retries reuse the existing snapshot.

For example, a COO can use Allow for `list_issues`, `assign_issue`, and
`email_get_message`, while leaving `email_send` on Ask. That COO can coordinate
work and read its assigned mailbox without getting stuck, but customer-facing
messages still wait for a human decision.

## Durable dispatch

`slab-email` exposes an admin-only, metadata-only inbound event feed. Slab
Agents commits the feed cursor and a unique `(automation, event)` occurrence in
one SQLite transaction before starting a Run. Each occurrence receives its Run
ID in advance, making retries idempotent across process restarts.

Immediately before dispatch, Slab Agents revalidates:

1. the automation still exists, is enabled, and targets the event account;
2. the agent exists and is enabled;
3. the agent still has read access to the selected account;
4. `email_get_message` is not No access;
5. the Email integration is Connected and the scoped connector token exists;
6. the remote account is enabled and supports reading.

Permanent local policy changes mark the occurrence skipped. Connector outages,
disabled remote accounts, and failures before a Run is durably created leave
the occurrence pending with bounded exponential backoff. Once dispatch commits,
later execution failures belong to that single workflow execution and do not
create a duplicate. The scheduler also advances completed steps and recovers
unfinished executions after process restarts. Pending work is traversed as a
stable bounded snapshot so one failing agent cannot starve healthy agents.
Remote account checks are cached per mailbox within a tick and dispatch runs
with bounded concurrency.

Email polling has its own single-flight worker. The cron scheduler launches it
without awaiting remote Email I/O, so a mailbox outage cannot delay scheduled
automations.

## Metadata boundary

Only the fields needed to identify and safely present the trigger are retained.
Names, addresses, subjects, thread IDs, and timestamps are control-character
sanitized and length bounded. At most 20 recipients are stored; the event
records `omittedRecipientCount` for the remainder. The complete serialized
event must remain below 32 KiB before it is persisted or added to a Run prompt.

Message bodies are never stored in the automation occurrence. The agent reads
the body through its scoped Email MCP profile after the Run starts.

## Operator checklist

Before enabling an Email automation:

1. Test the Email integration until its state is Connected.
2. Enable and test the receiving mailbox.
3. Give every workflow agent access to that mailbox.
4. Set `email_get_message` to Ask or Allow in Agent → Capabilities.
5. If the workflow replies, give the final agent reply/send access and choose
   its send policy deliberately.
6. Create the automation with Incoming email as its trigger, configure filters,
   and add the ordered Analyze, Draft, or Review-and-reply steps.
7. Send a new test message after creation and confirm one workflow execution
   appears with one linked Run per step as it advances.

The Automations page displays recent executions and their step states, including
links to each Run. It also shows a current feed/integration error or a pending
dispatch failure with its next retry time. Correct the connection, token,
mailbox, or runtime condition and leave the automation enabled; retryable
occurrences and active workflow executions resume automatically.
