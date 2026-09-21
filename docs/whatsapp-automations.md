# WhatsApp conversation automations

Connect the personal account in Integrations → WhatsApp, then grant a chosen
agent read and send access. **Set up replies** opens the WhatsApp
template in Automations. WhatsApp also appears alongside Schedule and Inbox email
when installed, without leaving the editor. Select specific contacts or explicitly
choose **Anyone who messages me**, then set a reply language and the owner
prompt/workflow; save a draft or explicitly activate replies. Nothing is
activated by installing WAHA or linking an account. The agent still needs read
and send access. **Before sending a reply** lets the owner choose approval for
every reply, no approval, or exceptions described in **When can replies be sent
without asking?**. Existing automations inherit the agent's sending setting until
explicitly changed. A new automation defaults to asking for every reply.

Exceptions apply only to that automation; they do not widen the agent's general
WhatsApp grant. Removing read/send access still stops it. Stricter custom tool
policies continue to apply. With conditional sending, the model evaluates the
owner's criteria and chooses automatic delivery or human review; uncertainty
requires review. This is an instruction-based decision, not a deterministic
semantic classifier. The review path uses a separate MCP server with the same
sending tool and a mandatory approval policy, including in unrestricted agent
modes. The send boundary additionally checks approval for the exact account,
recipient and unmodified text. Once review has been requested, the regular
sending path also requires that approval. Denial, changed configuration, new
messages or revoked access prevent a stale reply from being sent.

Incoming messages are authenticated WAHA `message.any` webhooks and stored
durably before acknowledgment. Consecutive messages wait for 8 seconds of quiet,
with a maximum of 30 seconds from the first pending message; both are configurable.
Each account/chat/agent has its own thread and only one active run per chat.
Different WhatsApp chats execute independently, including when one is waiting
for the owner's approval. They also run independently of the agent's ordinary
work queue. Turns within the same thread remain exclusive and ordered, including
manual turns started from Slab. The server dispatches them without an open browser.
Additional messages invalidate the unfinished turn, cancel its runtime and are
combined into the next turn after the active run ends. The MCP checks current
conversation state at the final outbound boundary, including after an approval.
An HTTP send already in flight cannot be withdrawn when a newer event arrives.

Replying manually from the phone pauses the chat until **Enable auto replies again**.
The conversation and run show an **Auto replies paused — you replied manually**
notice with that button. The same control appears in the automation's **Auto replies
by chat** section. Approval requests show **Reply waiting for your approval** instead;
they are reviewed separately. A disabled automation must be activated in its settings.
Enabling auto replies discards
the pending reply backlog and listens for new messages. An uncertain send also
pauses the chat: inspect WhatsApp before resuming. Each turn reserves a single
outbound attempt before contacting WAHA; ambiguous delivery is never retried.
Groups, broadcasts and self-chats do not trigger runs. Selected-contact mode also
excludes unselected chats; existing configurations keep this mode. All-chat mode
includes new numbers and people outside the address book. Active automations
cannot overlap: pause the existing automation before activating one for everyone.
The prompt decides whether to send a reply; an eligible message batch still starts
a run to make that decision. A completed run without a send consumes its messages
and leaves the chat listening. The preset forbids sending placeholders for ignored
messages. Read and send tools remain restricted to the current chat in both modes. Attachments are
represented as unavailable content; media is not downloaded or interpreted.
WAHA timestamps have one-second precision. Events within the activation/resume
boundary second are conservatively ignored to avoid answering earlier history.

## Editable reply safeguards

**Reply safeguards** starts with suggested rules that the owner can edit, extend,
clear or restore. These rules are saved with the automation, included in the
trusted owner configuration on every turn, and protected against direct copying
into replies. Edits advance the workflow version and invalidate unfinished turns.

`lib/whatsapp-guardrails.ts` keeps the channel's trust boundary, private-data
protections, selected language, honest identity and delivery controls separate
from the editable rules. The owner's editable workflow is another block; incoming messages stay in the
user-data input and cannot configure the language, permissions or workflow.
The preset covers direct and indirect injection, multi-turn/encoded extraction,
prompt and credential confidentiality, recipient isolation, natural prose,
the configured language, truthful responses about automation, and conservative
handling of unsupported requests and uncertain actions. It does not speculate
whether the correspondent is human or AI and does not impersonate the owner.
WhatsApp activation supports Codex, Claude and API runtimes. Gemini CLI is excluded
because its current adapter places both internal instructions and incoming
content in the same user prompt instead of separate system/user roles.

Enforcement outside the model includes a strict language setting, authenticated
events, exact account/chat checks on MCP reads and sends, current permission and
configuration versions, one outbound attempt per turn, and an outgoing validator
for structured output, common credential patterns and verbatim instruction spans.
WhatsApp runs do not recall or record the agent's shared Honcho memory. Their
conversation history stays in the dedicated thread. Assigned non-WhatsApp tools
remain subject to the agent's existing permissions and approvals: configure a
dedicated agent with only the resources its workflow needs.

The preset and deterministic validator reduce risk; they do not guarantee that
every model will resist every paraphrased/encoded injection or always obey the
language constraint. The validator is not a semantic language or secrecy judge.
Never put credentials in an editable prompt or treat a prompt as authorization.
Use approval-required sending when human review is needed. The regression suite
tests real local routing and send checks without making live WhatsApp sends;
model-level adversarial evaluation must use the selected runtime/model before
claiming a measured injection resistance rate.

Design references (reviewed 2026-09-12):

- [OWASP: prompt injection prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html): separate trusted instructions from external data, restrict tools, validate actions/output and test adversarial inputs.
- [OWASP: system prompt leakage](https://genai.owasp.org/llmrisk/llm072025-system-prompt-leakage/): keep secrets out of prompts and enforce authorization outside the model.
- [Anthropic: reduce prompt leaks](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-prompt-leak): explicit confidentiality instructions and monitoring, with acknowledged limitations.
- [Anthropic: mitigate prompt injection](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks): layered controls and adversarial evaluation.
- [WAHA events](https://waha.devlike.pro/docs/how-to/events/) and [sessions](https://waha.devlike.pro/docs/how-to/sessions/): signed webhooks and per-session configuration.

## Hosting

Activation merges a signed webhook into the existing WAHA session configuration,
preserving unrelated webhooks and engine settings. WAHA can briefly restart the
session when applying configuration; linked-device credentials are retained.
The default internal destination is
`http://slab-agents:3009/api/integrations/whatsapp/events`. Nonstandard deployments
can set `SLAB_WHATSAPP_WEBHOOK_URL` to a destination reachable from WAHA.
The webhook signing key is derived from the server's WAHA API key with a distinct
purpose label. The route requires a SHA-512 HMAC of the exact raw request body,
including when interactive authentication is disabled. It does not accept an
admin cookie instead of a signature. Keep the WAHA API itself private.

Run the migration before starting this version. Message IDs are retained for
durable replay protection; the local workspace database and its backups contain
conversation text. No provider API keys or raw engine payloads are stored with
incoming messages.
