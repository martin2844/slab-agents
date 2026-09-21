# Documentation screenshots

Captured on 2026-09-21 from the current development UI in a local browser. All names, tasks, documents, and API responses are fictional demo data. These images do not show a production account or imply that every pictured feature is in the latest stable release.

- `agents.png`: AgentsView with three agents and two active tasks.
- `docs-review.png`: DocsHistory and RunDocsChangesPanel with a two-document proposal and one expanded diff.
- `permissions.png`: AgentToolPolicyEditor in Custom mode, showing a subset of Docs tools.

To refresh them, render these components inside WorkspaceShell using an isolated local fixture, mock API responses, and capture with Chromium at a 1440 × 840 viewport (full page, 1× scale). Use the app’s actual fonts and styles. Keep all fixture names and document contents fictional; do not capture a live customer workspace.
