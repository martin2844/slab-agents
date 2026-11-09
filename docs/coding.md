# Coding runs (development preview)

A coding run turns a Work item into a reviewed draft pull request. Each stage is a normal Slab agent run that works in its own checkout of one GitHub repository:

```
PM → Tech spec → Plan review → Engineer → Code review → Publish → Final pass   │   PR feedback · Run chat
```

| Stage | What it does | When it stops for you |
| --- | --- | --- |
| PM | Reads the Work item, comments, Docs, and the repository. Writes `spec.md` and comments a summary on the Work item. | Always: approve the spec, answer its questions, or request changes. |
| Tech spec | Reads the code and writes a step-by-step `plan.md`. | Only when it has questions. |
| Plan review | Scores the plan against a fixed rubric (`review.md`). A failed plan goes back to the Tech Lead automatically, up to 2 times. | After the third failure. |
| Engineer | Implements the plan on the run branch, commits each step, runs the checks (`engineer.md`). Keeps the repository setup notes up to date. | When checks fail. |
| Code review | Reviews and fixes the branch (`code-review.md`). | Always: **Publish & open draft PR** pushes the branch and opens a draft PR. |
| Final pass | Writes the PR description (`pr-body.md`). Slab applies it to the PR. | — |
| PR feedback | On demand. Slab reads review comments from GitHub; the agent triages each one (fix, reply, no action); you review the decisions; the agent fixes the accepted ones; you publish the fixes and replies. | Each step. |
| Run chat | Ask about the run or request changes on the branch. Changes stay local until you choose **Publish changes**. | — |

Agents never push, never open pull requests, and never call GitHub. Slab publishes the branch (`slab/<work-item>-<n>`) with the GitHub App after you approve, opens the PR as a draft, and leaves merging to you. When the PR is merged, the Work item moves to Done.

## Set up

1. **Run the code runner.** It is a second Slab Runner container (`RUNNER_PROFILE=code`) with git and build tools. With Slab Stack:
   ```sh
   openssl rand -hex 32 > secrets/runner-code-token && chmod 600 secrets/runner-code-token
   docker compose -f compose.yml -f compose.private.yml -f compose.code.yml --profile code up -d
   ```
   For local development, start slab-runner with `RUNNER_PROFILE=code RUNNER_PORT=6991` and set `CODE_RUNNER_URL=http://127.0.0.1:6991` (and `CODE_RUNNER_TOKEN` when the runner uses a token) for Slab Agents.
2. **Sign in to Codex on the code runner** in **Coding → Settings**. It has its own login, separate from the main runner.
3. **Connect a GitHub App** in **Sources**. Apps created before Coding must accept the new permissions on GitHub: contents (write), pull requests (write), issues (write), checks and commit statuses (read). The App never requests the `workflows` permission, so GitHub rejects any agent change to `.github/workflows`.
4. **Add the repository** in **Coding → Settings**: default branch, setup/test/lint/typecheck commands, and the Work project that uses it by default.
5. **Create the stage agents** with **Create default agents**. They are normal agents (Code PM, Tech Lead, Plan Reviewer, Engineer, Code Reviewer, Release Writer, PR Fixer); edit their instructions, models, and reasoning effort on the Agents page, or assign other agents to stages.
6. Protect the default branch on GitHub (required review). Slab never merges.

## Start a run

Open a Work item and choose **Start coding run**, or use **New coding run** on the Coding page. Pick the repository and add an optional note for the PM.

The run page shows the stage strip (time, cost, model per stage), the pull request with CI state, each stage's output, conversation and activity, and every handoff file with its attempts. **Re-run from here** restarts a stage and every later one. Replying to a finished stage continues the same conversation and restarts the later stages.

## Security model

The code runner container is the sandbox: Codex runs there without per-command approvals. The container holds only its own Codex login and runner token.

- **GitHub tokens.** Installation tokens reach the code runner only during clone and push, never while an agent runs. They are limited to the one repository and to `contents` (read for clone, write for push). Pull requests, comments and CI state use a separate token that never leaves Slab.
- **Publishing.** The runner pushes from a clean copy of the branch, never from the agent's checkout, and only to the run branch. It refuses any commit that touches `.github/workflows/` or `.gitmodules`.
- **Tools.** Coding stages get only Work and Docs. Email, calendar, Google and custom integrations are never passed to them, even when the agent has them.
- **PR comments.** Comments from people outside the repository (anyone can comment on a public repository) start dismissed and never reach the agent unless you reopen them. The same applies to bot summaries.
- **Repository setup notes.** The Engineer keeps the setup notes up to date and every later run reads them. Review them in **Coding → Settings** from time to time.
- **Accepted risk.** Code the agent runs can read the code runner's own Codex login and runner token. Keep the code runner off any network it does not need.
