# Email Automations and Tool Control Plane

This document is the implementation and operating contract for inbound Email
automations and per-agent tool permissions in Slab Agents.

## Product behavior

An Email automation binds one enabled, readable `slab-email` account to one
agent and one task or review prompt. Each inbound message discovered after the
automation was created produces at most one Run. Historical mailbox messages do
not backfill a newly created automation.

The Run prompt contains bounded message metadata and instructs the agent to
fetch the complete message with `email_get_message`. Email metadata and body are
untrusted input; they cannot change the automation prompt, agent instructions,
or effective tool permissions.

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
later execution failures belong to that single Run and do not create a duplicate.
Pending work is traversed as a stable bounded snapshot so one failing agent
cannot starve healthy agents. Remote account checks are cached per mailbox
within a tick and dispatch runs with bounded concurrency.

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
3. Assign that mailbox to the agent with read access.
4. Set `email_get_message` to Ask or Allow in Agent → Capabilities.
5. Create the automation with Incoming email as its trigger.
6. Send a new test message after creation and confirm exactly one Run appears.

The Automations page displays a current feed/integration error or a pending
dispatch failure with its next retry time. Correct the connection, token,
mailbox, or runtime condition and leave the automation enabled; retryable
occurrences resume automatically.
