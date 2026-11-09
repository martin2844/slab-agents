# Autonomy

Autonomy sets how much the agents do on their own. Configure it in **Autonomy** (sidebar, under Configure).

## Levels

| Level | Name | What the agents do |
| --- | --- | --- |
| 0 | Manual | Nothing starts on its own. Agents answer only when you use them. |
| 1 | Reactive (default) | Automations (schedule, email, WhatsApp) and Work triggers, with each agent's tool policies. This is Slab without autonomy. |
| 2 | Supervised | Level 1, plus: a planning loop of the lead agent, follow-ups, questions to you on Telegram, delegation, coding runs started by agents, and changes to automations and agents as drafts that you apply. |
| 3 | Autonomous | No gates: draft PRs are published when the code review is ready, agent changes apply at once, outbound messages go out within the daily cap, and tool approvals are automatic except the red lines. |

An install without autonomy settings is level 1 and behaves exactly as before.

The level is a preset. Each capability can be set by hand, and each agent can be capped at a lower level:

| Capability | Values |
| --- | --- |
| Triggers | off · on |
| Planning loop | off · on |
| Follow-ups | off · on |
| Ask the human | off · on |
| Delegation | off · on |
| Self-management | off · draft · automatic |
| Coding runs | you · agents · on assignment to the Engineer |
| Coding approvals | you · automatic (only when the review says ready) |
| Outbound messages | off · ask me · agent setting · automatic up to the daily cap (then ask me); the email service also caps new emails per account (50 a day by default) |
| Tool approvals | agent policy · automatic for Work, Docs, email, calendar, and analytics (never red lines or custom integrations) |
| Unanswered approvals | wait · remind me · remind, then deny |
| Memory from every run | chats only · every run |
| Guards | off · on |

**Red lines** always ask you, at every level: deleting Work items, archiving or reverting Docs, cancelling calendar events, merging and releases, money, integrations, credentials, permissions, budgets, and the autonomy level. An explicit "approval required" cap (for example an email account's send policy) is never loosened by autonomy.

**Guards** (on from level 2): concurrent runs, run time limit, delegation depth, autonomous runs per day. The email service also limits new emails per account per day and refuses recipients on the opt-out list.

**Pause** (button, or `/pausa` on Telegram) drops to level 0 at once and remembers the level to restore.

## Telegram

1. Create a bot with @BotFather and copy its token.
2. In **Autonomy → Telegram**, paste the token and choose **Save**.
3. Send `/start <code>` to the bot from your Telegram account within 30 minutes. Only that chat can use the bot.

Slab sends you: approvals with Approve / Deny buttons, questions from agents (buttons for options, or reply to the message), proposals to apply or reject, coding stages that wait for you (approve, or reply to request changes), pull requests ready for review and builds, failed runs, blocked Work, reminders, and a daily digest.

Commands: `/estado`, `/pausa`, `/reanudar`, `/nivel 0-3`, `/tarea <text>` (a task for the lead agent), `/preguntas`. Any other message goes to the lead agent, and its answer comes back as a reply.

Slab uses long polling, so it works without a public domain.

## Agent tools

From level 2 the agents get the `slab` tool server (only the tools their capabilities allow): `ask_human`, `notify_human`, `schedule_followup`, `list_followups`, `cancel_followup`, `list_agents`, `start_agent_run`, `start_coding_run`, `list_automations`, `create_automation`, `update_automation`, `set_automation_enabled`, `create_agent`, `update_agent_instructions`.

- A question ends the run; Slab starts a new run with the answer, or with the default answer (or none) after the wait time.
- Agents can only change schedule automations. Agents they create get at most the "full" permission mode and no integrations.
- Coding stages never get these tools.

## Start an autonomous company

1. Install the **Autonomous Company** blueprint (CEO, Support, Growth). Add the coding agents in **Coding → Settings → Use Code PM and Engineer**.
2. Connect Work, Docs, the support mailbox, and a separate outreach mailbox. Link each repository to its Work project in **Coding → Settings**.
3. In **Autonomy**, choose the CEO as lead agent, link Telegram, and start at level 2. Move to level 3 when the drafts and questions look right.
4. Desktop builds: add a release workflow to the repository (see `docs/templates/desktop-builds.yml`). Slab never edits workflows; you merge and run the builds.
