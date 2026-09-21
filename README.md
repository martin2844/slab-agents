# Slab Agents

**Give AI agents work to do, the context they need, and clear limits on what they can change.**

Slab Agents is a workspace you host on your own server. Create agents for roles like customer support, sales, or operations. Chat with them, assign work, or let an automation start a task. See what they did, review actions that need your approval, and keep your documents in one place.

[Install Slab](#install-slab) · [Your first agent](#your-first-agent) · [Screenshots](#a-look-inside) · [Documentation](#documentation)

## Install Slab

Run this on the Linux server where you want Slab to live:

```sh
curl --proto '=https' --tlsv1.2 -fsSL \
  https://github.com/martin2844/slab-stack/releases/latest/download/install.sh \
  | sudo sh
```

The guided installer sets up the Slab services with Docker, helps you choose how to access the workspace, and prints the URL to open when it finishes. It shows you the installation plan before making changes. You do not need to clone these repositories or install Node.js to use it.

**Before you start:** use a supported Linux server with administrator access. Ubuntu 24.04 is a supported choice; plan for at least 4 GB of RAM and 25 GB of free disk space. You will also need access to an AI runtime supported by your release. Your server and AI usage are paid separately.

Prefer to read the script first?

```sh
curl --proto '=https' --tlsv1.2 -fsSL \
  https://github.com/martin2844/slab-stack/releases/latest/download/install.sh \
  -o install.sh
less install.sh
sudo sh install.sh
```

See the [installation guide](docs/getting-started.md) for the next steps and [Slab Stack](https://github.com/martin2844/slab-stack#readme) for supported servers, upgrades, backups, and troubleshooting.

> The installer downloads the latest stable release. Screenshots and features described here reflect the current development version; newer features may not be included in stable yet. Check the [release notes](https://github.com/martin2844/slab-stack/releases) for the version you install.

## What can you do with it?

- **Give each agent a job.** Choose its instructions, AI model, documents, tools, and permissions.
- **Keep work organized.** Assign tasks, follow progress, and see what is blocked or waiting for you.
- **Automate repeat work.** Start a morning review on a schedule, process incoming email, or handle WhatsApp conversations.
- **Share useful context.** Give agents company documents and selected external knowledge sources.
- **Review changes.** Inspect tool activity, approve actions, compare document edits, and revert published changes when they do not conflict with newer work.
- **Connect your tools.** Add email, calendars, analytics, WhatsApp, and custom integrations, then choose which agents can use them.

You decide how much an agent can do on its own. Connecting an account does not automatically give every agent access to it.

## Your first agent

1. **Connect an AI runtime** in **Settings → Runtime** and check that it is ready.
2. **Create an agent** in **Agents**, or start with a **Blueprint**: a template that includes agents, instructions, and workflows.
3. **Give it context and access.** Add a useful document, assign the tools it needs, and start with **Guarded** permissions.
4. **Send one clear task.** For example: “Review our support guide and suggest answers to the five most common questions.”
5. **Review the result.** Open the conversation or run to see the response, tool activity, and any changes waiting for approval.

Once that works, turn the repeated task into an automation.

### A few terms you will see

| In Slab | What it means |
| --- | --- |
| **Agent** | An AI assistant with a role, instructions, and its own access to tools. |
| **Run** | One attempt by an agent to complete a task or respond to a conversation turn. |
| **Automation** | A saved workflow started by a schedule or an incoming message. |
| **Work** | Your shared tasks and projects. |
| **Docs** | Documents you and your agents can use and edit. |
| **Sources** | External knowledge you make available to selected agents. |
| **Integration** | A connection to a service, such as email or a calendar. |
| **Runtime** | The AI execution service an agent uses, such as Codex. |

## A look inside

These are screenshots of the real interface using fictional demo data.

### Your agents and their work

See each agent’s role, current activity, and assigned tools.

![Agents list with three assistants for operations, support, and research](docs/images/agents.png)

### Review document changes together

An agent can prepare edits across several documents. When review is required, it finishes its work and leaves one proposal for you to approve and merge. With full editing permission, a successful run publishes the changes together as one commit.

![Document proposal showing a before-and-after diff and Approve and merge controls](docs/images/docs-review.png)

### Choose what happens automatically

Use **Guarded** for work that needs your review, **Full** for more autonomy, or **Custom** to choose **Allow**, **Ask**, or **No access** for each tool. An integration can still require approval for sensitive actions.

![Custom tool permissions showing Allow, Ask, and No access for document tools](docs/images/permissions.png)

## A few things to know

- Keep your server running for automations to run. You do not need to keep the browser or a conversation open.
- Slab is a single-user workspace. It does not provide organization roles or a separate account for each teammate.
- Self-hosting keeps the workspace on your server. The AI provider and connected services still process the information you send to them.
- WhatsApp uses WAHA, an unofficial WhatsApp Web connection. It is not the official WhatsApp Business API and may stop working or put the connected account at risk. [Read the WhatsApp setup guide](docs/whatsapp.md) before connecting an account.
- Permission changes apply to new runs. A run already in progress keeps the permissions it started with.

## Documentation

- [Install Slab and create your first agent](docs/getting-started.md)
- [Permissions, approvals, and document changes](docs/permissions-and-docs.md)
- [Email automations](docs/email-automations-and-tool-control-plane.md)
- [WhatsApp setup](docs/whatsapp.md) and [automatic replies](docs/whatsapp-automations.md)
- [Calendars](docs/calendar-integrations.md), [Google Analytics and Search Console](docs/google-data-integrations.md), and [custom integrations](docs/custom-integrations.md)
- [Knowledge sources](docs/sources.md), [memory](docs/memory.md), and [Blueprints](docs/operator-packs.md)
- [Notifications](docs/operator-notifications.md)
- [Development, configuration, and architecture](docs/development.md)

For local development, see the [development guide](docs/development.md#run-locally). The installer above is the starting point for hosting Slab on a server.

## License

[MIT](LICENSE)
