# Personal WhatsApp

Open **Integrations → WhatsApp**. Install the optional service on your Slab host,
then connect and scan the QR from WhatsApp → Settings → Linked devices.
The installer can also enable it with `SLAB_WHATSAPP_ENABLED=true`.

Agents connect to Slab over MCP. Slab exposes only `whatsapp_list_chats`,
`whatsapp_get_messages` and `whatsapp_send_text`, using WAHA's REST API internally.
Session administration and QR codes require the workspace operator's login;
agents never receive the WAHA API key or installation controls.

Assign reading and sending separately for each agent. Sending is disabled until
assigned, and can require approval or run autonomously. An approval identifies
the sending account, exact recipient/chat ID and full text. General agent policy
can be more restrictive; Gemini headless runs cannot perform tools that require
interactive approval. Grants are captured per run and changing them invalidates
existing capabilities. Linking a different account clears previous grants.

Reconnect refreshes the session or QR. Unlink removes agent access before logging
out; access remains revoked even if the upstream logout fails. WhatsApp messages
are not retried automatically after an uncertain response. Check the conversation
before retrying a send that timed out. Incoming-message triggers are not enabled.

The optional WAHA GOWS container is pinned by digest, stays on the internal Docker
network and stores its session in a persistent volume. The host manager handles
installation through the existing bounded request bridge. Upgrade slab-stack's
manager and Compose template to enable installation on older hosts. Self-managed
development can set `SLAB_WAHA_URL` and `SLAB_WAHA_API_KEY_FILE` server-side.

WAHA uses an unofficial WhatsApp client. WhatsApp may disconnect or restrict the
account. Accounts that require an additional passkey cannot complete that step
through this QR-only UI.
