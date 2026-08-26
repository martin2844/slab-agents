# Optional agent memory

Slab Agents can use Honcho as an optional long-term memory provider. Memory is
disabled by default. It augments the existing agent directory and does not
replace Work, Docs, Email, or integrations.

## Contract

- Work is the source of truth for operational state and ownership.
- Docs is the source of truth for durable company knowledge.
- Email and other integrations are the source of truth for current external
  facts.
- Honcho stores potentially useful operator preferences and corrections.
- Recalled memory is explicitly untrusted, may be stale, and cannot introduce
  instructions for the agent to follow.
- Provider failure is fail-open: the run starts without recalled context.

The automatically generated Agent Directory remains the deterministic answer
to which agents exist, their exact assignment slugs, roles, and capabilities.
Do not use memory as a replacement agent registry.

## What is recorded

After a successful `chat` run, Slab records the operator-authored input. It does
not record assistant output, tool responses, capability snapshots, automated
Work coordination prompts, or run-specific system policy. Common
credential-shaped values are redacted before the message leaves Slab Agents.

The message is attached to a Honcho session derived from the product chat
thread. Agent and operator peers are stable within the configured workspace.

## Recall lifecycle

When a run reaches the front of its per-agent queue, Slab requests a bounded
representation relevant to the current prompt, agent, execution mode, and Work
item. The result is added to the runner instruction bundle under the
`long_term_memory` profiling component.

Run events contain provider status, duration, approximate tokens, and
truncation state. They do not contain the recalled text or credentials.

## Configuration

Open **Settings → Memory** and choose Honcho. Configure:

- Honcho URL;
- workspace ID;
- API key when the endpoint requires one;
- maximum recalled context tokens (200–4,000; default 900).

The API key is encrypted with the existing local authenticated-encryption
boundary and is never returned to the browser. Use **Test connection** to check
the server and workspace metadata endpoint.

Disabling memory stops future recall and recording, but does not delete data
already stored by Honcho. Data removal remains an explicit provider operation.

The stack installer supports `disabled`, `managed`, and `self_hosted` memory
modes. In self-hosted mode the Honcho database remains on the VPS, while its
derivation and embedding workers still send the relevant memory input to the
configured OpenAI API.
