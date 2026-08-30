# Operator notifications

Slab can send deterministic Email alerts when unattended work needs a human.
Notifications are control-plane behavior, not Agent Runs, so they consume no
model tokens and cannot invent recipients or message content.

Configure them in **Settings → Notifications** after connecting an Email
account with send capability. Select the actual sender mailbox and the operator
recipient, save, then use **Send test**.

The MVP notification set covers:

- pending approvals;
- failed Runs, including Automation Runs;
- blocked Work observed by Work Coordination;
- integrations marked unavailable;
- failed system update requests.

## Delivery guarantees

- Each event has a durable idempotency key and is delivered through a SQLite
  outbox.
- Delivery retries up to five times with bounded exponential backoff.
- The Email operation uses a scoped connector profile with send-only access to
  the selected account.
- The one-time raw connector token is encrypted in the local token vault and is
  never stored in SQLite or returned to the browser.
- Immediately before delivery, Slab revalidates that the approval, block, or
  failure still needs attention. Resolved events are cancelled rather than
  delivered stale.
- Notification delivery never changes the Run or Work state that produced it.

Notifications include compact links to the relevant local Slab page. They do
not include tool payloads, prompts, mailbox bodies, credentials, or stack
traces.
