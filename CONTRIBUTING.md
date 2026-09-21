# Contributing to Slab Agents

Thanks for helping improve Slab. Useful contributions include reproducible bug reports, clearer documentation, better onboarding, and focused fixes.

## Choose where your change belongs

This repository owns the web workspace, agents, permissions, and orchestration. Installation and stack release issues belong in [slab-stack](https://github.com/martin2844/slab-stack). Document storage belongs in [slab-docs](https://github.com/martin2844/slab-docs), task storage in [slab](https://github.com/martin2844/slab), and runtime execution in [slab-runner](https://github.com/martin2844/slab-runner).

If you are unsure, explain what you were doing and what failed in a Slab Agents issue. For a larger feature, open an issue describing the problem and proposed behavior before investing in the implementation.

## Set up locally

Use **Node.js 22**, the version used in CI, and npm. The complete local stack also needs Docker and sibling checkouts of Work, Docs, and Runner.

1. Fork this repository and clone your fork.
2. Run `npm ci` in `slab-agents`.
3. Follow [local development](docs/development.md#run-locally) to set up the sibling repositories and [service credentials](docs/development.md#configuration). Install the Runner dependencies in its checkout too.
4. Run `npm run stack:dev` from `slab-agents`, then open **http://127.0.0.1:3009**.

If the required services are already running, use `npm run dev` for the web app alone. Keep development services bound to loopback. Use a separate local workspace with sample data; changes to agents and automations can trigger real AI calls and external actions.

## Make and verify the change

Keep a pull request focused on one problem. Follow the existing component and service patterns, and read [AGENTS.md](AGENTS.md) and the relevant bundled Next.js documentation before changing framework behavior.

For code changes, run:

```sh
npm test
npm run lint
npm run typecheck
npm run build:check
```

Use `build:check` while a development server is running so the build does not replace its assets. Add regression coverage when fixing behavior, especially permissions, approval handling, queued work, and failure recovery. For UI changes, check a narrow and a wide viewport and include screenshots with fictional data.

CI also checks shell scripts with ShellCheck, builds the production container, and runs the container smoke test. For documentation-only changes, verify links, commands, and rendering; no new tests are needed unless the documented contract changes.

## Open a pull request

Explain the user-visible problem, the resulting behavior, and how you checked it. Link an existing issue when there is one. Mention changes to configuration, migrations, or deployment requirements explicitly.

Do not include credentials, local databases, customer messages, or screenshots of a live account. Screenshot conventions are in [docs/images](docs/images/README.md).

## Report a bug

Include your Slab version or commit, installation method, runtime, steps to reproduce, expected behavior, and what happened instead. Small, redacted log excerpts are more useful than entire log files. Never paste `.env` contents or API keys.

Use the [bug report template](https://github.com/martin2844/slab-agents/issues/new?template=bug_report.md). For a suspected vulnerability, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
