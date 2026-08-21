# Slab Self-Hosted VPS Installation Plan

Status: implementation in progress  
Date: 2026-08-20  
Primary target: single-user installation on one Linux VPS  
Initial runtime: Codex through `codex app-server`  
Public entry point: `https://slab.ar/install.sh`

## Implementation progress

Last updated: 2026-08-21

| Milestone                                       | Status            | Evidence                                                                                      |
| ----------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------- |
| Plan committed                                  | Complete          | `slab-agents@8dc598e`                                                                         |
| Local `slab-stack` repository                   | Complete          | `slab-stack@df635e4`                                                                          |
| Manifest, service, image, and Compose contracts | Complete          | `slab-stack@df635e4`                                                                          |
| Initial Codex version lock                      | Complete          | Codex CLI `0.148.0`, `slab-stack@9fa934e`                                                     |
| Slab Agents production runtime contract        | Published         | `ghcr.io/martin2844/slab-agents@sha256:ef8309d534e4f75a39ae78f5fb58ea89cc16e7d1457a66a3d477809fbca4de39` |
| Slab Agents single-user authentication         | Published         | scrypt password, stdin bootstrap, revocable sessions, proxy/CSRF/rate-limit image smoke passed  |
| Runner production image                         | Published         | `ghcr.io/martin2844/slab-runner@sha256:7cd7c1da0aa14a710c7b9c2ac59e16679e3a684513b78da6e22dc7976d078377` |
| Runner multi-arch publication                   | Complete          | Public amd64/arm64 pull, signature, provenance, SBOM, and 0 high/critical scan verified        |
| Slab Work production image                      | Published         | `ghcr.io/martin2844/slab@sha256:3190a68db66331027605dec6f07dfd12565b0ed9132d518b25367609edf1cfc5`        |
| Slab Docs production image                      | Published         | `ghcr.io/martin2844/slab-docs@sha256:0521012b5465e92192699eb13a13826f07739995531e1a963c8e09db25a7d59a` |
| Slab Email production image                     | Published         | `ghcr.io/martin2844/slab-email@sha256:1e3b48c612e70ec5afdbe364c3435d55df7654122a586e10909e0bb5392e02b3` |
| Immutable stack candidate                       | Complete          | `slab-stack/releases/v0.1.0-candidate.7.json` pins all five public images by tag and digest     |
| Private full-stack integration                  | Complete          | `slab-stack#8`: clean Compose boot, bootstrap, connections, CRUD, restart, persistence, and network gate |
| Versioned functional installer                  | Complete          | `slab-stack#9`, merge `63c3280`: interactive/non-interactive flow, lock, state ledger, admin bootstrap, readiness, and sanitized diagnostics |
| Installer private-mode integration              | Complete          | Candidate.2 installs, authenticates, reruns without bootstrap credentials, preserves secrets/data, and passes CI full-stack smoke |
| Codex onboarding and runtime readiness           | Complete          | `slab-runner#2`, `slab-agents#2`, `slab-stack#10`: persistent auth, `slabctl`, UI guidance, restart, and authenticated readiness |
| Codex-enabled stack candidate                    | Complete          | Candidate.4 passes 69 installer tests, ShellCheck, private full-stack smoke, login/logout, and idempotent installer rerun |
| Ubuntu 26.04 and Docker host bootstrap           | Complete          | `slab-stack#11`, merge `478e5ec`: official Docker apt repository, pinned signing-key fingerprint, and conflict-safe setup |
| Clean VPS install and real Codex runtime smoke   | Complete          | Clean Ubuntu 26.04 amd64 VPS: Docker bootstrapped, private stack healthy, headless device auth completed, `SLAB_RUNTIME_OK` run completed |
| Real Work + Docs agent run                       | Complete          | UI-created COO run completed with 7/7 successful tool calls, persisted Docs document `demo-operating-notes`, and persisted Work issue `OPS-1` |
| systemd stack lifecycle                          | Complete          | `slab-stack@0c29c25`; real Ubuntu 26.04 VPS restart preserved Work, Docs, administrator access, and Codex auth with `slab.service` enabled/active |
| Real domain and TLS                              | Complete          | `agents.c5h.dev`; Caddy obtained a trusted Let's Encrypt certificate, HTTP redirects to HTTPS, public `:3009` is closed, and `slabctl domain verify` promotes state to `READY` (`slab-stack@ecfdc12`) |
| Signed public bootstrap candidate               | Complete          | GitHub release `v0.1.0-candidate.7`; Ed25519 signature/checksum verified, byte-reproducible bundle, CI green |
| Candidate bootstrap VPS dry-run                 | Complete          | Ubuntu 26.04 VPS verified signature/checksum and dry-ran `candidate.7`; production remained ready |
| Candidate.7 production reconciliation           | Complete          | Seven-volume verified backup, additive Email migration to schema 2, exact image digests, systemd active, HTTPS ready, and direct port closed |
| Web-managed Gmail OAuth                         | Deployed          | Settings owns the server-side admin flow; OAuth secret is encrypted only by `slab-email`, absent from API/UI reads, and production reports an actionable `missing` state |
| Managed Proton Bridge                           | In progress       | One `slab-email` lifecycle packages Proton Bridge 3.26.0 by pinned SHA; private PTY controller, encrypted generated credentials, Settings flow, and `slabctl proton setup` are implemented pending candidate publication and real-account QA |
| Stable public installer                         | Blocked by design | Candidate channel only; backup/restore, update/rollback, and remaining VPS matrix still gate `stable` |

Current next gate: complete backup/restore and the remaining clean-VPS matrix, then
promote the signed, version-pinned bootstrap from `candidate` to `stable`.
Candidate.7 is published as a signed GitHub Release, its bundle reproduces byte-for-byte with the
pinned packaging toolchain, and the clean
Ubuntu 26.04 VPS now proves Docker bootstrap, private installation, headless
ChatGPT device auth, authenticated readiness, a direct Codex invocation, and a
UI-created agent run that persisted data through Work and Docs. The managed
systemd lifecycle also survives a real full-stack restart without losing Work,
Docs, administrator access, or runtime authentication. Domain mode is now
proven at `https://agents.c5h.dev` with a trusted Let's Encrypt certificate,
Caddy as the only public service, and the direct application port closed. The
remaining clean-VPS matrix and stable-channel promotion remain intentionally
pending. The `stable` channel is not published yet.

## 1. Outcome

The finished installation experience should be:

```bash
curl -fsSL https://slab.ar/install.sh | sudo sh
```

The safer inspect-first form must be documented beside it:

```bash
curl -fsSL https://slab.ar/install.sh -o install-slab.sh
less install-slab.sh
sudo sh install-slab.sh
```

The installer asks only for information that cannot be generated safely:

1. Installation directory, default `/opt/slab`.
2. Access mode: public domain or private access.
3. Domain name and optional ACME email when public domain mode is selected.
4. Initial single-user administrator password.
5. Whether to authenticate Codex immediately or later.

Everything else is generated or seeded automatically:

- Docker network and volumes;
- Work, Docs, Runner, Email, session, and internal control-plane secrets;
- internal service URLs;
- Caddy configuration;
- database migrations;
- Compose project configuration;
- a `slabctl` management command;
- initial service health verification.

The result is one operational control plane at either:

```text
https://agents.example.com
```

or, in private mode:

```text
http://127.0.0.1:3009
```

accessed through an SSH tunnel or private network. Plain public HTTP on the VPS IP is not a safe default because it exposes the login password and session cookie in transit.

## 2. Product boundary

The deployment must preserve the current product architecture:

```text
Slab Agents = who acts, when, and with which capabilities
Slab        = what needs to be done
Slab Docs   = what the company knows
Slab Email  = scoped mailbox access
Slab Runner = how an agent runtime executes
```

Docker Compose supervises processes. Slab Agents orchestrates agents. Slab Agents must not receive the Docker socket and must not become a container supervisor.

Custom HTTP and MCP integrations remain inside `slab-agents`; there is no separate connector daemon.

## 3. Target architecture

### 3.1 Network topology

```text
                                    Internet
                                       │
                                  TCP 80 / 443
                                       │
                                ┌──────▼──────┐
                                │    Caddy    │
                                │ TLS + proxy │
                                └──────┬──────┘
                                       │ private Docker network
                                ┌──────▼──────┐
                                │ slab-agents │
                                │ Next :3009  │
                                └──┬──┬──┬──┬─┘
                                   │  │  │  │
                 ┌─────────────────┘  │  │  └──────────────────┐
                 │                    │  │                     │
          ┌──────▼──────┐      ┌──────▼──▼─────┐       ┌──────▼──────┐
          │ slab-runner │      │ Work / Docs   │       │ slab-email │
          │    :6990    │      │ MCP services  │       │    :6981   │
          └──────┬──────┘      └───────────────┘       └─────────────┘
                 │
          ┌──────▼──────┐
          │ Codex       │
          │ app-server  │
          └─────────────┘
```

Only Caddy publishes public ports. Work, Docs, Email, Runner, and the custom-integration MCP route remain reachable only on Docker networks. The backend network still permits outbound traffic because Runner must reach model providers, Email must reach mail providers, and Slab Agents may call remote HTTP/MCP integrations.

### 3.2 Compose services

The first stack contains:

```text
caddy
slab-agents
slab-api
slab-mcp
slab-docs
slab-email
slab-runner
```

`slab-api` and `slab-mcp` may continue using the same Slab image and SQLite volume. They remain separate processes because the current image already exposes both entry points. Their migration lifecycle must be made deterministic before release.

### 3.3 Persistent data

```text
/opt/slab/
├── compose.yml
├── compose.domain.yml           # generated only for domain mode
├── compose.private.yml          # generated only for private mode
├── Caddyfile
├── VERSION
├── release-manifest.json
├── config/
│   └── install.env              # non-secret host configuration, mode 0644
├── secrets/                     # root-owned, mode 0700
│   ├── work-api-key
│   ├── docs-api-key
│   ├── runner-token
│   ├── email-admin-key
│   ├── email-master-key
│   └── session-secret
├── backups/                     # root-owned, mode 0700
└── data/                        # Docker named volumes or bind mounts
```

Named volumes are preferred for application state. The installer records the actual volume names in the release metadata so backup and restore do not depend on guessing Compose-generated names.

Persistent volumes:

```text
slab_agents_data     control-plane SQLite, local encryption key, token vault
slab_work_data       Work SQLite database
slab_docs_data       Docs SQLite database
slab_email_data      Email SQLite database and encrypted account credentials
slab_runner_codex    dedicated CODEX_HOME and refreshed auth state
caddy_data           certificates, ACME state, private keys
caddy_config         Caddy runtime state
```

## 4. Repository ownership

Create a distribution repository named `slab-stack`. It is packaging infrastructure, not a runtime microservice.

```text
slab-stack/
├── install.sh                    # stable, small bootstrap script
├── bin/
│   └── slabctl
├── installer/
│   ├── install.sh                # versioned implementation
│   └── lib/
│       ├── preflight.sh
│       ├── prompts.sh
│       ├── docker.sh
│       ├── secrets.sh
│       ├── render.sh
│       ├── health.sh
│       └── codex.sh
├── templates/
│   ├── compose.yml
│   ├── compose.domain.yml
│   ├── compose.private.yml
│   ├── Caddyfile.domain
│   ├── systemd.service
│   └── install.env
├── releases/
│   └── vX.Y.Z.json
├── tests/
│   ├── unit/
│   ├── fixtures/
│   └── vps/
└── .github/workflows/
    ├── test.yml
    ├── release.yml
    └── vps-smoke.yml
```

Repository responsibilities:

| Repository    | Owns                                                                    |
| ------------- | ----------------------------------------------------------------------- |
| `slab-agents` | Next.js image, login/session, settings, orchestration, scheduler, UI    |
| `slab`        | Work API/MCP image, Work database migrations, Work health               |
| `slab-docs`   | Docs image, Docs database migrations, Docs health                       |
| `slab-email`  | Email image, account/profile/token storage, Email health                |
| `slab-runner` | Runner image, pinned Codex binary, runtime adapters, runtime auth state |
| `slab-stack`  | Installer, Compose, Caddy, `slabctl`, release manifest, VPS QA          |

## 5. Current-state inventory and gaps

| Service     | Image now | CI now              | Main release gaps                                                                    |
| ----------- | --------- | ------------------- | ------------------------------------------------------------------------------------ |
| Slab Agents | Yes       | CI + image release  | candidate published and unified private-stack smoke passed                            |
| Slab Work   | Yes       | CI + image release  | candidate published and unified private-stack smoke passed                            |
| Slab Docs   | Yes       | CI + image release  | candidate published and unified private-stack smoke passed                            |
| Slab Email  | Yes       | CI + image release  | candidate published and unified private-stack smoke passed                            |
| Slab Runner | Yes       | CI + image release  | bundled Codex candidate published and unified private-stack smoke passed              |

Important implementation facts already present and reusable:

- every product service already uses SQLite;
- Slab Agents already uses Knex migrations;
- Work, Docs, Email, and Runner expose a health endpoint;
- Slab Agents already keeps MCP credentials server-side;
- Slab Agents already encrypts custom-integration secrets with AES-256-GCM;
- Runner already supports a bearer token and normalized streaming events;
- Runner already uses a dedicated managed `CODEX_HOME`;
- integrations are already snapshotted at run start;
- Work/Docs/Email/custom MCP capabilities already flow from Slab Agents to Runner.

Known gaps that must be fixed rather than hidden in Compose:

1. Slab Agents has no `/health` route.
2. Slab Agents production scripts bind to `127.0.0.1`; the container needs an explicit internal bind without exposing it on the host.
3. `npm run build` currently runs Knex migrations through `prebuild`; a container image build must never create or mutate a runtime database.
4. Runner rejects non-loopback bind addresses; it needs an authenticated container-network mode.
5. Runner assumes Codex is installed on the host; the release image must pin and contain it.
6. Slab API and Slab MCP both invoke migrations while sharing one SQLite database; startup ordering must be deterministic.
7. Existing service compose files are development/service-specific files, not the production stack definition.
8. Slab Agents currently has no configured Git remote; image publication requires creating or linking its canonical repository first.
9. `slab-docs` currently has unrelated uncommitted local changes; release preparation must not accidentally bundle them without review.
10. PostHog and Custom Integration MCP URLs are currently generated with `127.0.0.1:3009`; in a separate Runner container that address resolves to Runner itself. URL generation needs a server-only `CONTROL_PLANE_INTERNAL_URL` while browser links continue using the public origin.

## 6. Release and image strategy

### 6.1 Registry

Use GitHub Container Registry:

```text
ghcr.io/<slab-org>/slab-agents
ghcr.io/<slab-org>/slab
ghcr.io/<slab-org>/slab-docs
ghcr.io/<slab-org>/slab-email
ghcr.io/<slab-org>/slab-runner
```

The registry owner is a release-time configuration until the final GitHub organization is chosen. Public one-command installation requires all five packages to permit anonymous pulls. Do not require a customer to create a GHCR token.

### 6.2 Version model

Service versions and stack versions are independent:

```text
service image version: v0.3.1
stack release version: v0.1.0
```

A stack release manifest pins exact image digests:

```json
{
  "schemaVersion": 1,
  "stackVersion": "0.1.0",
  "releasedAt": "2026-08-20T12:00:00Z",
  "minimumSlabctlVersion": "0.1.0",
  "images": {
    "agents": {
      "ref": "ghcr.io/<slab-org>/slab-agents:v0.1.0",
      "digest": "sha256:..."
    },
    "work": {
      "ref": "ghcr.io/<slab-org>/slab:v0.1.0",
      "digest": "sha256:..."
    },
    "docs": {
      "ref": "ghcr.io/<slab-org>/slab-docs:v0.1.0",
      "digest": "sha256:..."
    },
    "email": {
      "ref": "ghcr.io/<slab-org>/slab-email:v0.1.0",
      "digest": "sha256:..."
    },
    "runner": {
      "ref": "ghcr.io/<slab-org>/slab-runner:v0.1.0",
      "digest": "sha256:..."
    }
  },
  "codexVersion": "<exact-version>",
  "migrationCompatibility": {
    "minimumRollbackStack": "0.1.0"
  }
}
```

Compose uses digest-qualified references from the installed manifest. `latest` may exist for humans but is never consumed by installer or updater.

### 6.3 Per-repository image workflow

Each repository gets a reusable release workflow that:

1. runs lint, typecheck, tests, and production build;
2. builds with Docker Buildx;
3. targets `linux/amd64` and `linux/arm64`;
4. runs a single-platform container smoke test before publishing;
5. pushes semver, major/minor, and Git SHA tags;
6. emits OCI source, revision, version, license, and created-at labels;
7. generates SBOM and provenance attestations;
8. scans the final image for known critical/high vulnerabilities;
9. signs the digest with keyless Cosign through GitHub OIDC;
10. uploads the digest and test evidence as workflow artifacts.

Release tags are immutable. Re-running a failed release may rebuild the same source only if no digest has been published. Published tags are never overwritten.

### 6.4 Stack release workflow

`slab-stack` does not rebuild product images. It:

1. accepts the five tested digests;
2. verifies anonymous pulls for both architectures;
3. verifies signatures and provenance;
4. renders the release manifest and versioned installer bundle;
5. boots the complete stack in clean amd64 and arm64 environments;
6. runs install, login, CRUD, runtime, backup, update, rollback, and uninstall smoke tests;
7. publishes a signed GitHub Release;
8. publishes `install.sh` and the release metadata at `slab.ar`;
9. moves the `stable` channel only after the VPS matrix passes.

## 7. Containerization work

### 7.1 Slab Agents image

Build a multi-stage Node 22 Debian slim image. Debian is preferred over Alpine for predictable `better-sqlite3` native-module behavior across architectures.

Required changes:

- enable Next standalone output or copy the full production dependency set deliberately;
- remove database migration side effects from `prebuild`;
- add a dedicated container entrypoint;
- run Knex migrations against `/data/slab-workspace.db` at container start or through a one-shot migration command;
- bind Next to `0.0.0.0:3009` only inside the container;
- run as a non-root `slab` user;
- persist `/data`;
- expose, but do not publish, port `3009`;
- add `/health` for process + SQLite availability;
- add `/ready` for schema readiness without requiring optional integrations;
- preserve `/api/setup/status` or equivalent for Work/Docs/Runner health in the UI;
- ensure the scheduler is started exactly once in the single container;
- handle SIGTERM and stop scheduling new runs during shutdown.

The Docker build command must not open `.data/slab-workspace.db`. A build is a pure artifact build.

### 7.2 Slab Runner image

Build a Node 22 Debian slim image containing:

- compiled `slab-runner`;
- an exact pinned version of `@openai/codex`;
- CA certificates and the minimum runtime packages Codex requires;
- an unprivileged `slab-runner` user;
- `/var/lib/slab-runner/codex` as the dedicated persistent `CODEX_HOME`;
- an empty per-run working directory root;
- no global MCP configuration.

Runner network change:

```text
local development
RUNNER_HOST=127.0.0.1

container deployment
RUNNER_HOST=0.0.0.0
RUNNER_TOKEN_FILE=/run/secrets/runner-token
```

Non-loopback binding must be rejected unless authentication is configured. Compose publishes no Runner host port. This preserves defense in depth while allowing Slab Agents to connect through Docker DNS.

Add health semantics:

```text
GET /health    runner process and internal event manager are alive
GET /runtimes  Codex installed, app-server started, and auth state reported
```

Lack of Codex authentication makes `codex.available = false`; it must not cause the container healthcheck to restart Runner forever.

### 7.3 Slab Work image

Retain the existing image and two entry points, but add:

- a release workflow;
- explicit `migrate` command in the production image;
- a one-shot Compose migration service, or an equivalent transaction/lock gate;
- `SKIP_MIGRATIONS=true` for API/MCP after the one-shot migration succeeds;
- health and readiness checks that distinguish process health from schema readiness;
- non-root runtime verification on both architectures;
- a smoke test proving concurrent API and MCP access to the same SQLite volume.

### 7.4 Slab Docs image

Retain the existing Debian slim image and add:

- release workflow and OCI labels;
- a deterministic migration command/entrypoint;
- `/ready` or equivalent schema readiness;
- Compose hardening and log rotation;
- amd64/arm64 health smoke tests;
- a test proving document data survives image replacement.

### 7.5 Slab Email image

Retain the existing image and add:

- release workflow and pinned image dependencies;
- Compose healthcheck for `/health`;
- deterministic database migration readiness;
- internal origin settings that use Compose service names, not public wildcard origins;
- graceful shutdown that closes the SQLite connection and active IMAP/SMTP clients;
- clear readiness when the service is healthy but no mailbox exists;
- deployment documentation for Gmail OAuth redirect URLs;
- a managed Proton Bridge lifecycle in the same `slab-email` container on amd64;
- a pinned, checksum-verified official Proton binary and preserved GPL license;
- a private controller that never exposes Proton login credentials through API,
  MCP, logs, environment, argv, or persistence;
- the same challenge-based setup flow through Settings and `slabctl`;
- manual/external Bridge support for existing deployments;
- explicit warning that a Proton Bridge running on a laptop is not reachable from a remote VPS.

Email is optional at the product layer but its service can run with zero accounts. A missing mailbox must not make the whole stack unhealthy.

## 8. Unified Compose design

The base Compose file contains no public ports and no plaintext secrets:

```yaml
name: slab

networks:
  edge:
  control:

services:
  slab-agents:
    image: ${SLAB_AGENTS_IMAGE}
    expose: ["3009"]
    networks: [edge, control]
    volumes:
      - slab_agents_data:/data
    secrets:
      - work_api_key
      - docs_api_key
      - runner_token
      - email_admin_key
      - session_secret
    environment:
      SLAB_WORKSPACE_DB: /data/slab-workspace.db
      WORK_MCP_URL: http://slab-mcp:6969/mcp
      DOCS_MCP_URL: http://slab-docs:6980/mcp
      RUNNER_URL: http://slab-runner:6990
      SLAB_EMAIL_URL: http://slab-email:6981
      CONTROL_PLANE_INTERNAL_URL: http://slab-agents:3009
      SLAB_PUBLIC_URL: ${SLAB_PUBLIC_URL}
      TRACKER_API_KEY_FILE: /run/secrets/work_api_key
      DOCS_API_KEY_FILE: /run/secrets/docs_api_key
      RUNNER_TOKEN_FILE: /run/secrets/runner_token
      SLAB_EMAIL_ADMIN_KEY_FILE: /run/secrets/email_admin_key
      SLAB_SESSION_SECRET_FILE: /run/secrets/session_secret

  slab-runner:
    image: ${SLAB_RUNNER_IMAGE}
    expose: ["6990"]
    networks: [control]
    volumes:
      - slab_runner_codex:/var/lib/slab-runner/codex
    secrets: [runner_token]
    environment:
      RUNNER_HOST: 0.0.0.0
      RUNNER_PORT: 6990
      RUNNER_TOKEN_FILE: /run/secrets/runner_token
      RUNNER_CODEX_HOME: /var/lib/slab-runner/codex
      CODEX_BIN: /usr/local/bin/codex
```

The final template includes all services, healthchecks, volumes, secrets, logging, and dependency conditions. The excerpt above only establishes the boundary.

Do not mark `control` as a Docker `internal` network: that would also remove required outbound connectivity. Isolation comes from publishing no backend ports, keeping Caddy off the control network, and authenticating internal APIs. If outbound allowlisting becomes necessary later, implement it at the host/firewall or egress-proxy layer with explicit provider destinations.

Container hardening baseline:

- non-root user;
- `read_only: true` where compatible;
- writable volume only for the service data directory;
- bounded `/tmp` tmpfs;
- `cap_drop: [ALL]` unless a verified exception exists;
- `security_opt: [no-new-privileges:true]`;
- `init: true`;
- `restart: unless-stopped`;
- JSON log rotation (`10m`, 3 files);
- memory and CPU guidance documented per VPS size;
- no Docker socket mount;
- no host network mode;
- no public ports except Caddy.

Recommended minimum host for the first release:

```text
2 vCPU
4 GB RAM
25 GB SSD
Ubuntu 24.04 LTS or Debian 12
amd64 or arm64
```

The installer warns below the minimum but allows an explicit continue.

## 9. Secret model

### 9.1 Generated secrets

The installer generates at least 32 random bytes for each independent secret:

```text
Work API/MCP key
Docs API/MCP key
Runner bearer token
Email admin key
Email encryption master key
Slab Agents session secret
```

Secrets are generated from the kernel CSPRNG, written under `/opt/slab/secrets`, owned by root, and never printed. The installation log records only that a secret was created.

All services should gain `_FILE` variants for secrets they currently accept only through environment variables. The code reads exactly one of `NAME` or `NAME_FILE` and rejects ambiguous double configuration. Compose mounts the files read-only at `/run/secrets`.

### 9.2 Product-managed secrets

Custom-integration keys and future provider API keys remain encrypted by Slab Agents using its existing authenticated-encryption layer. The encryption key is stored in the control-plane data volume and included in backups. Raw values are write-only:

- never returned by GET endpoints;
- never rendered in HTML;
- never included in run events or capability snapshots;
- never added to prompts;
- redacted from tool previews and logs.

### 9.3 Codex authentication

Codex owns its refreshable authentication state inside `slab_runner_codex`. Treat the volume as a password-equivalent secret. It is never mounted into Slab Agents.

## 10. Single-user authentication

Slab Agents must implement real application authentication before any public VPS release.

### 10.1 Data model

Minimum tables:

```text
admin_user
  id
  password_hash
  password_changed_at
  created_at
  updated_at

sessions
  id_hash
  user_id
  created_at
  expires_at
  last_seen_at
  revoked_at
```

There is exactly one administrator in the first release. The schema should not pretend to provide organizations or RBAC.

### 10.2 Password and session rules

- hash passwords with Argon2id and stored parameters;
- never store the initial password in Compose, `.env`, process arguments, or shell history;
- accept bootstrap/reset passwords on stdin;
- use a random opaque session token and store only its hash server-side;
- set cookies `HttpOnly`, `Secure` in HTTPS mode, and `SameSite=Lax`;
- rotate the session identifier at login and password change;
- revoke all sessions after password reset;
- use a bounded idle timeout and absolute lifetime;
- rate-limit login by source and globally;
- use constant-time credential comparison where applicable;
- protect mutating endpoints with origin/CSRF validation;
- return generic login errors.

Protect all page routes, API route handlers, Server Actions, streaming endpoints, run approvals, setup routes, and custom MCP management routes. Only `/login`, `/health`, static assets, and the necessary OAuth callback are exceptions. OAuth callback state must be validated and bound to an authenticated setup attempt.

Use installer-generated `SLAB_PUBLIC_URL` as the canonical origin for secure-cookie, CSRF, redirect, and OAuth callback decisions. Do not derive security decisions from arbitrary `Host` or `X-Forwarded-*` headers. The internal MCP callback URL remains a separate server-only value and never becomes the browser origin.

Run-scoped machine endpoints such as `/api/integrations/:id/mcp` do not require a browser session, but they must validate their own opaque bearer capability and should be blocked at Caddy so only the control network can reach them.

### 10.3 Bootstrap

The installer starts the data volume and invokes a one-shot admin CLI:

```text
read password twice from /dev/tty without echo
        │
        ▼
pipe password to `slab-agents admin create --password-stdin`
        │
        ▼
Argon2id hash written to control-plane SQLite
        │
        ▼
plaintext buffer cleared; nothing written to disk
```

`slabctl password reset` uses the same stdin-only path for recovery.

## 11. Access modes and Caddy

### 11.1 Public domain mode

Generated Caddyfile:

```caddyfile
{$SLAB_DOMAIN} {
    encode zstd gzip
    reverse_proxy slab-agents:3009

    header {
        X-Content-Type-Options nosniff
        Referrer-Policy strict-origin-when-cross-origin
        X-Frame-Options DENY
        -Server
    }
}
```

Caddy persists `/data` and `/config`. Automatic HTTPS works when A/AAAA records resolve to the VPS, ports 80/443 are reachable, and Caddy storage is writable. The installer checks all four and reports the exact failing condition.

The public proxy should return 404 for Runner-only MCP callback paths such as `/api/integrations/*/mcp`. Runner reaches those endpoints over `CONTROL_PLANE_INTERNAL_URL`; they still enforce their run-scoped bearer credential. Health and the authenticated product API remain reachable as designed.

The domain setup flow:

```text
enter agents.example.com
        │
        ├─ detect public IPv4/IPv6
        ├─ resolve A/AAAA
        ├─ check local ports 80/443
        ├─ render Caddyfile
        └─ start Caddy and wait for HTTPS
```

If DNS is not ready, installation may complete as `TLS pending`. Caddy can retry in the background, and `slabctl domain verify` reports the remaining action. Do not repeatedly hit ACME staging/production during installer tests.

### 11.2 Private mode

Private mode publishes only:

```text
127.0.0.1:3009:3009
```

The completion message provides:

```bash
ssh -L 3009:127.0.0.1:3009 user@server
```

The user then opens `http://127.0.0.1:3009` locally. An explicit `--allow-insecure-public-http` escape hatch may bind `0.0.0.0:3009`, but it must require a typed acknowledgement and print that credentials are not encrypted in transit.

### 11.3 Domain changes

Domain, port, and Caddy changes remain `slabctl` operations because they mutate host networking and certificates:

```bash
sudo slabctl domain set agents.example.com
sudo slabctl domain verify
sudo slabctl domain remove
```

Slab Agents may display current public URL and health, but it must not receive host filesystem or Docker privileges merely to edit Caddy.

## 12. Installer design

### 12.1 Stable bootstrap

`https://slab.ar/install.sh` should be a small POSIX shell bootstrap, not the full mutable installer. It:

1. detects platform and architecture;
2. selects `stable` or the requested `--version`;
3. downloads the versioned installer bundle and checksum/signature to `mktemp -d`;
4. verifies checksum and signature;
5. executes the verified versioned installer;
6. removes the temporary directory on exit.

The bootstrap supports:

```bash
sudo sh install.sh --version 0.1.0
sudo sh install.sh --channel stable
sudo sh install.sh --dry-run
sudo sh install.sh --non-interactive --config /root/slab-install.conf
```

Passwords are never accepted as command-line values. Non-interactive mode uses a root-readable password file or stdin descriptor.

### 12.2 Preflight

Supported initial hosts:

- Ubuntu 22.04/24.04/26.04 LTS;
- Debian 12;
- `amd64` and `arm64`.

Preflight checks:

- root privileges;
- interactive `/dev/tty` unless non-interactive mode is explicit;
- supported OS and architecture;
- at least 4 GB RAM and 25 GB free disk, with warnings below threshold;
- system clock synchronization;
- `curl`, `ca-certificates`, `openssl`, `tar`, `jq`, and DNS utilities;
- existing Docker Engine and Compose V2;
- conflicting Docker packages;
- ports 80/443/3009;
- existing `/opt/slab` installation and its version;
- DNS when domain mode is selected;
- anonymous access to every pinned image.

If Docker is absent, install it through Docker's official apt repository for the detected supported distribution. Do not nest the Docker convenience script because Docker explicitly does not recommend that path for production provisioning.

### 12.3 Interactive flow

```text
Welcome to Slab
│
├─ Installation directory [/opt/slab]
├─ Access mode
│  ├─ Public domain
│  │  ├─ Domain
│  │  └─ ACME email (optional)
│  └─ Private through SSH/Tailscale
├─ Administrator password
├─ Summary and confirmation
├─ Generate secrets
├─ Install Docker when required
├─ Download and verify stack release
├─ Pull pinned images
├─ Run migrations/bootstrap admin
├─ Start services
├─ Wait for health
├─ Authenticate Codex now? [Y/n]
└─ Print URL, status, and next commands
```

### 12.4 Idempotency and interruption

The installer maintains a local state file containing completed non-secret steps. Re-running the same version:

- reuses existing secrets;
- never recreates the admin user without confirmation;
- re-renders drifted templates safely;
- resumes image pulls;
- runs idempotent migrations;
- reconciles Compose services;
- repeats health checks;
- does not delete data.

Every destructive recovery action requires an explicit target and confirmation. The installer never runs broad recursive deletion against `/`, `$HOME`, or an unresolved variable.

### 12.5 Completion states

Installation can finish as:

```text
READY             all services and Codex available
READY_NO_RUNTIME  services healthy; Codex authentication pending
TLS_PENDING       services healthy; DNS/certificate pending
FAILED            stack not usable; failing component and recovery shown
```

Codex authentication failure must not roll back a healthy product installation.

## 13. `slabctl`

Install `/usr/local/bin/slabctl` as a versioned shell CLI that locates `/opt/slab` and delegates to pinned Compose files.

Required commands:

```text
slabctl status
slabctl doctor
slabctl logs [service]
slabctl start
slabctl stop
slabctl restart [service]
slabctl update [version]
slabctl version
slabctl backup [destination]
slabctl restore <backup>
slabctl password reset
slabctl codex login
slabctl codex status
slabctl codex logout
slabctl domain set <fqdn>
slabctl domain verify
slabctl support-bundle
slabctl uninstall
```

`doctor` checks:

- Docker daemon and Compose V2;
- installed manifest and image digests;
- container health;
- SQLite volume writeability and available disk;
- internal DNS and authenticated service connectivity;
- Caddy config, DNS, ports, certificate expiry;
- Runner process and Codex availability/auth status;
- Work/Docs/Email health;
- clock skew;
- recent restart loops.

The support bundle contains versions, health responses, redacted Compose config, bounded logs, and failure summaries. It excludes `.env`, secret files, Codex auth, integration secrets, raw email configuration, cookies, and run payloads.

## 14. Codex installation and authentication

### 14.1 Packaging

Codex CLI is installed in the Runner image at build time, pinned to an exact version recorded in the stack manifest. It is not installed globally on the VPS host.

Benefits:

- reproducible Runner/Codex compatibility;
- upgrades occur through an image release;
- no host Node/npm dependency;
- no host/user `~/.codex` coupling;
- rollback returns both Runner and Codex to a tested pair.

### 14.2 First login

After the stack is healthy, the installer offers:

```bash
docker compose exec slab-runner codex login --device-auth
```

through `slabctl codex login`. Device-code login is preferred on a headless VPS. The user opens the printed URL on another device and enters the code. After login:

```bash
docker compose exec slab-runner codex login status
```

must succeed, `/runtimes` must report Codex available, and the UI setup check must become healthy.

API-key login is optional and must be stdin-only:

```text
read key without echo
pipe to `codex login --with-api-key`
never include it in argv or install.env
```

`slab_runner_codex` must be backed up and protected like a credential store.

### 14.3 Web management

First public release:

- Settings shows Codex installed/authenticated/available state;
- Settings explains `slabctl codex login` when authentication is missing;
- CLI owns the interactive device login because it is reliable on a headless server.

Follow-up release, only after a stable machine-readable Runner flow exists:

- start device authorization from Settings;
- display verification URL/code;
- poll sanitized status;
- allow logout/re-authentication;
- keep all auth state inside Runner's volume.

Do not parse unstable human CLI output in the control plane merely to claim web login support.

## 15. Future runtime adapters

Codex remains the first and fully supported runtime. New runtimes extend the existing Runner adapter contract instead of changing Slab Agents workflows.

```text
slab-agents Run
      │
      ▼
normalized Runner request
      │
      ├── CodexAdapter          native app-server
      ├── ClaudeAgentAdapter    Claude Agent SDK
      └── AiSdkAdapter          API models / OpenAI-compatible providers
             ├── Anthropic API
             ├── OpenAI API
             └── Kimi API
```

The normalized contract must continue to cover:

- streaming assistant output;
- runtime thread/session identifiers;
- tool started/completed/failed lifecycle;
- approvals;
- usage and cached-token fields where available;
- cancellation;
- normalized failures;
- runtime warnings;
- fresh/resumed continuity semantics.

### 15.1 Claude

Use the Claude Agent SDK for a Claude Code-style runtime. For a third-party product deployment, default to Anthropic API credentials or a supported cloud provider such as Bedrock or Vertex. Do not promise that a customer's Claude subscription OAuth can be embedded in Slab without explicit provider approval and a verified supported authentication contract.

### 15.2 Kimi and API runtimes

Use Vercel AI SDK's `ToolLoopAgent` as the API harness and `@ai-sdk/openai-compatible` for providers with a compatible endpoint. This removes provider-loop boilerplate while Slab retains control of:

- tools and capability snapshot;
- approvals;
- maximum steps;
- budgets;
- usage events;
- retries and timeouts;
- audit trail.

Kimi ACP/CLI can be evaluated later as an experimental native adapter. Kimi API support should ship first because it is easier to meter and control.

### 15.3 No mandatory gateway

Do not introduce LiteLLM in the first deployment. Direct provider connections preserve transparent billing and reduce infrastructure. Reconsider a gateway only when centralized multi-tenant keys, provider failover, or cross-provider routing becomes a real operational need.

## 16. Runtime configuration in the web UI

The final product should allow routine runtime configuration in Settings without making the web process a host administrator.

### 16.1 Editable in Slab Agents

- enable/disable installed runtime adapters;
- write-only provider API keys and rotation;
- default and allowed models;
- per-agent runtime/model selection;
- runtime health and authentication status;
- per-run, per-day, and monthly budgets;
- max model calls/steps, output tokens, wall time, and retries;
- per-agent and per-automation overrides;
- capability and integration assignments;
- Email accounts/access profiles/send policy;
- Work, Docs, Email, PostHog, HTTP, and MCP integration settings.

Provider keys are encrypted in Slab Agents. For an API run, the key is sent to Runner only over the authenticated internal request, held in memory, and excluded from prompts, events, logs, and profiling. This matches the existing server-side MCP credential boundary.

### 16.2 Kept in `slabctl`

- domain and Caddy changes;
- public ports and access mode;
- install directory;
- Docker/image versions;
- update and rollback;
- backup and restore;
- disaster password reset;
- uninstall;
- host-level diagnostics.

This division avoids mounting Docker socket or `/opt/slab` into the Next.js app.

## 17. Cost controls

Slab Agents remains the policy authority even when the model loop comes from an SDK.

Minimum data model:

```text
runtime_providers
runtime_models
runtime_credentials
runtime_policies
usage_ledger
budget_reservations
model_pricing_catalog
```

Controls:

- workspace, agent, automation, and run budgets;
- daily and monthly periods;
- maximum steps/model calls;
- maximum output tokens;
- wall-clock timeout;
- retry ceiling;
- concurrency ceiling per agent/provider;
- disable-on-budget-exhaustion behavior;
- estimated and provider-reported cost stored separately.

Before an API call or run starts, create a transactional budget reservation so concurrent agents cannot both spend the final allowance. Reconcile the reservation with reported usage afterward. A crashed run expires its reservation through a recovery job.

Codex/Claude subscription runtimes may not expose authoritative USD cost. For those, enforce step, token, and time limits and label any cost number as estimated. Never imply dollar precision that the provider does not expose.

## 18. Health, observability, and logs

### 18.1 Health contract

Every service exposes:

```text
/health  liveness: process can serve and its local DB/runtime manager responds
/ready   readiness: schema and mandatory local dependencies are ready
```

Exceptions can preserve existing routes initially if Compose gets equivalent checks, but the contract should converge before stable release.

Slab Agents' own readiness must not depend on optional Email accounts, PostHog, custom integrations, or Codex login. Those appear as system-health warnings, not container crash loops.

### 18.2 Startup dependency graph

```text
secret files
    │
    ├── Work migration ──► slab-api + slab-mcp
    ├── Docs migration ──► slab-docs
    ├── Email migration ─► slab-email
    └── Agents migration + admin bootstrap
                             │
                             ├──► slab-runner
                             └──► slab-agents
                                      │
                                      └──► Caddy
```

Compose `depends_on` is used only with health/completion conditions. The installer still performs an explicit bounded readiness loop and prints sanitized logs for the first failing dependency.

### 18.3 Logging

- structured JSON where practical;
- service, version, request/run ID, severity, and timestamp;
- no full environment dumps;
- no headers containing credentials;
- no raw auth files, cookies, passwords, API keys, or integration secrets;
- bounded payload previews already used by run profiling;
- Docker log rotation;
- Caddy access logs off by default or sanitized and rotated;
- `slabctl logs` supports service and time filters.

## 19. Backup and restore

The first release should favor correctness over zero downtime.

### 19.1 Backup flow

```text
slabctl backup
    │
    ├─ verify disk space
    ├─ stop scheduler from creating new runs
    ├─ wait/cancel active runs with explicit policy
    ├─ stop SQLite writers in dependency order
    ├─ checkpoint WAL files
    ├─ archive application volumes + manifest + Caddy + secrets
    ├─ calculate checksum
    ├─ chmod 0600
    └─ restart and health-check stack
```

The backup archive contains credentials. It is root-readable only and must be transferred/stored securely. Optional `age` encryption can be added without changing the archive contents, but an unencrypted world-readable backup is never acceptable.

### 19.2 Restore flow

Restore requires:

- explicit backup path;
- checksum verification;
- confirmation of target installation;
- stack stop;
- safety backup of current state;
- restore to matching or compatible stack version;
- migrations only after compatibility verification;
- full health and login check.

Test restore, not only backup creation. A backup is not considered valid until a clean VPS can restore and read agents, Work, Docs, Email metadata, and runtime auth state.

## 20. Updates and rollback

`slabctl update` flow:

```text
fetch signed channel metadata
        │
verify installer + release manifest
        │
compare compatibility and disk space
        │
create pre-update backup
        │
pull digest-pinned images
        │
run one-shot migrations
        │
reconcile Compose
        │
wait for health + smoke test login/API
        │
record new VERSION
```

If containers fail before an incompatible migration is committed, restore the previous manifest/images automatically. If database migrations are not backward compatible, automatic image rollback is unsafe; restore the pre-update backup and state this clearly.

Migration policy for all repositories:

- expand/contract changes across at least one stack release;
- migrations idempotent and tested from every supported previous version;
- no destructive column/table removal in the same release that stops reading it;
- manifest declares minimum rollback version;
- backup is mandatory before schema changes.

### 20.1 Release discovery

Update discovery and update execution are separate trust boundaries.

`slab-agents` may perform a read-only server-side check against a release index:

```text
GitHub channel JSON (default) or configured release index
        │
        ▼
ReleaseChannelClient in slab-agents
        │
        ├── current stack version
        ├── latest compatible version
        ├── release notes / severity
        └── signed asset metadata
```

The default source is the stable channel in `martin2844/slab-stack`. A future
Slab-hosted release service may implement the same small versioned contract. The
UI must not depend directly on GitHub-specific response shapes.

Checks run at startup and then at a bounded interval (initially every six hours,
with jitter and ETag/If-None-Match support). Failure to reach the index is a
non-fatal `unknown` update state, not a service-health failure. Store only:

```text
source
channel
current_version
latest_version
checked_at
etag
status
sanitized_error
release_notes_url
```

The browser never calls GitHub or the release server directly. It reads this
state through an authenticated `slab-agents` API and can request `Check now`.

Release discovery is advisory. Before any update, the host updater independently
downloads the versioned manifest and verifies the same Ed25519 signature,
checksum, immutable image digests, compatibility metadata, and anti-downgrade
rules used by the installer. A compromised or stale channel pointer cannot cause
unverified code to run.

### 20.2 Settings UI

Add `Settings → System updates`:

```text
Current version     0.1.0
Channel             Stable
Latest version      0.1.1 available
Last checked        4 minutes ago

[ Check now ] [ Review update ] [ Install update ]
```

The detail view shows release notes, compatibility, backup requirement, active
runs, expected maintenance, and the signed artifact fingerprint. The first
release supports manual apply only. Automatic detection may be enabled by
default; unattended automatic installation is disabled.

Only the authenticated workspace administrator can request an update. Existing
CSRF/session protections apply. Update attempts and outcomes are persisted in a
small audit log without credentials or raw host logs.

### 20.3 Privilege boundary for panel-triggered updates

Do not mount `/var/run/docker.sock` into `slab-agents`, run the app container as
root, or expose a generic command endpoint.

Use a narrow host-side systemd boundary:

```text
authenticated admin clicks Install update
        │
        ▼
slab-agents writes one declarative request
{ requestId, targetVersion, channel }
        │
        ▼
root-owned systemd.path / oneshot updater
        │
        ├── accepts only a strict version/channel schema
        ├── acquires the existing installation lock
        ├── invokes versioned slabctl update
        ├── verifies signed release assets independently
        └── writes a sanitized status/result record
        │
        ▼
slab-agents polls read-only status and updates the UI
```

The request/status directory is a dedicated bind mount. The application can
request only `check` or `install` for a concrete release; it cannot pass shell
fragments, Compose arguments, paths, URLs, environment variables, or arbitrary
commands. The host helper chooses every executable and filesystem path.

The helper must treat compromise of `slab-agents` as permission to request a
valid signed update, not as permission to control Docker or the host. It rejects
concurrent updates, replayed request IDs, unsupported channels, downgrades, and
targets outside the signed index.

### 20.4 Update lifecycle from the panel

```text
requested
  → waiting_for_idle
  → preflight
  → backing_up
  → pulling
  → migrating
  → reconciling
  → verifying
  → completed
```

Terminal alternatives are:

```text
failed_preflight
failed_backup
failed_apply
rolled_back
manual_recovery_required
cancelled_before_apply
```

Before apply:

1. reject if another installer/update holds the installation lock;
2. verify disk space, release signature, compatibility, and current identity;
3. wait for active agent runs to finish, or require an explicit administrator
   choice to cancel before any containers are stopped;
4. pause new scheduler/coordination dispatches through a persisted maintenance
   flag;
5. create and verify a pre-update backup;
6. run the existing `slabctl update` lifecycle;
7. require Work, Docs, Email, Runner, login, and readiness smoke checks;
8. clear maintenance mode only after success or a completed rollback.

Closing the browser does not cancel the host update. Reopening Settings reads
the status file and resumes progress display. The UI never claims success based
only on a started systemd unit.

### 20.5 Delivery sequence

Implement in this order:

1. signed channel contract plus `ReleaseChannelClient` and read-only update UI;
2. complete and test `slabctl update`, backup, restore, and rollback from CLI;
3. add the strict request/status protocol and root-owned systemd oneshot;
4. add panel-triggered manual updates with active-run drain and audit trail;
5. exercise previous-stable → candidate → rollback on the VPS matrix;
6. consider unattended security updates only after multiple stable releases.

This sequence keeps update detection useful immediately without giving the web
application premature host privileges.

## 21. Uninstall

`slabctl uninstall` defaults to removing containers, network, systemd unit, and CLI while preserving data, secrets, and backups.

Deleting data is a second explicit operation:

```text
Type DELETE SLAB DATA to remove:
/opt/slab
application volumes
Caddy certificate state
Codex authentication
```

The command resolves and prints every target before deletion. No glob, home directory, filesystem root, or unresolved variable can be accepted as a deletion target.

## 22. Implementation phases

### Phase 0: lock release contracts

- [x] Choose the final GitHub organization and public GHCR namespace.
- [x] Create/link the canonical `slab-agents` remote.
- [x] Create `slab-stack` repository.
- [x] Define stack manifest schema and semver policy.
- [x] Define supported OS/architecture matrix.
- [x] Define common `/health`, `/ready`, `_FILE`, OCI label, and graceful-shutdown contracts.
- [x] Record the exact initial Codex package/version pairing.
- [x] Add a release compatibility document shared by all repos.

Exit gate: an empty stack manifest can resolve one immutable digest for each service and verify it anonymously.

### Phase 1: service production readiness

#### Slab Agents

- [x] Add application login, sessions, logout, password change, reset CLI, CSRF/origin checks, and rate limiting.
- [x] Add `/health` and `/ready`.
- [x] Separate build from migrations.
- [x] Add container entrypoint and admin bootstrap CLI.
- [x] Add secret `_FILE` support.
- [x] Use `CONTROL_PLANE_INTERNAL_URL` for run-scoped PostHog and Custom Integration MCP URLs instead of loopback.
- [ ] Add graceful scheduler/run shutdown.
- [x] Add production Dockerfile and `.dockerignore`.

#### Slab Runner

- [x] Add authenticated container-network bind mode.
- [x] Add secret `_FILE` support.
- [x] Build Runner + pinned Codex image.
- [x] Persist the managed Codex home with correct ownership.
- [x] Add graceful app-server shutdown and container healthcheck.

#### Work, Docs, Email

- [x] Add consistent `_FILE` secret support.
- [x] Add deterministic one-shot migration commands.
- [x] Add readiness checks.
- [x] Verify graceful shutdown and WAL checkpoint behavior.
- [x] Harden Dockerfiles/Compose defaults without changing service APIs.

Exit gate: every service boots from an image as non-root, passes health, survives restart, and preserves data.

### Phase 2: image publication

- [x] Add CI and GHCR publishing to all five repos.
- [x] Build `amd64` and `arm64` images.
- [x] Add SBOM, provenance, vulnerability scan, and signature.
- [x] Mark GHCR packages public.
- [x] Prove anonymous pulls from a clean machine.
- [x] Publish first immutable service tags and capture digests.

Exit gate: the stack can be assembled entirely from registry images with no source checkout and no VPS build.

### Phase 3: unified stack

- [x] Implement base Compose and domain/private overrides.
- [x] Add networks, secrets, volumes, resource guidance, healthchecks, and logging.
- [x] Add Caddy templates and persistent certificate volumes.
- [x] Add systemd unit to reconcile the Compose project on boot.
- [x] Seed internal Work/Docs/Runner/Email URLs automatically.
- [x] Add migration/bootstrap jobs and dependency conditions.
- [x] Verify no internal service is host-published.

Exit gate: `docker compose up -d` on a clean host reaches healthy UI and services using generated files only.

### Phase 4: installer and `slabctl`

- [x] Implement verified bootstrap downloader.
- [x] Implement interactive and non-interactive configuration.
- [x] Install Docker from official apt repositories when absent.
- [x] Generate secret files and templates idempotently.
- [x] Bootstrap the admin password over stdin.
- [x] Implement private mode plus domain rendering and Caddy validation.
- [x] Implement DNS/TLS diagnostics.
- [ ] Implement all required `slabctl` commands.
- [x] Add install state, resumability, dry-run, and sanitized failure output.
- [ ] Publish `install.sh` at `slab.ar` with appropriate cache headers.

Exit gate: one command installs a usable authenticated stack on all supported VPS targets.

### Phase 5: Codex onboarding

- [x] Add `slabctl codex login/status/logout`.
- [x] Use headless device authorization by default.
- [x] Support API key through stdin as an alternative.
- [x] Surface runtime status in Settings and setup checklist.
- [x] Add first-run COO creation only after runtime is available, or make the disabled state explicit.
- [x] Authenticate Codex on a headless Ubuntu 26.04 VPS and complete a direct Runner model invocation.
- [x] Run a real Work + Docs agent smoke test.

Exit gate: a new operator installs, authenticates Codex, creates an agent, and completes one run without editing files manually.

### Phase 6: lifecycle operations

- [ ] Implement backup and verified restore.
- [ ] Implement signed update channels and pre-update backup.
- [ ] Add server-side release detection and `Settings → System updates`.
- [ ] Add the narrow systemd request/status bridge for manual panel updates.
- [ ] Verify the web container has no Docker socket or arbitrary host command path.
- [ ] Implement compatible rollback behavior.
- [ ] Implement support bundle and doctor.
- [ ] Implement safe uninstall and preserve-data default.
- [ ] Add disk-space monitoring and backup retention guidance.

Exit gate: update and restore are tested on copies of real multi-service data, not empty databases.

### Phase 7: web-managed runtimes and cost policy

- [ ] Add runtime provider/model/credential/policy tables and encrypted write-only APIs.
- [ ] Add Settings runtime UI.
- [ ] Add per-agent runtime/model/cost controls.
- [ ] Add budget reservation and usage reconciliation.
- [ ] Add provider/model pricing catalog with versioned estimates.
- [ ] Preserve current run profiling across adapters.

Exit gate: an operator can configure an API runtime and hard spending limits from the web without exposing a provider key.

### Phase 8: Claude and Kimi

- [ ] Implement AI SDK adapter and direct provider credentials.
- [ ] Add Kimi through an OpenAI-compatible provider.
- [ ] Implement Claude Agent SDK adapter with API/cloud-provider authentication.
- [ ] Normalize tools, approvals, cancellation, usage, and thread semantics.
- [ ] Add adapter conformance suite.
- [ ] Keep experimental CLI/ACP adapters behind explicit feature flags.

Exit gate: each runtime passes the same conformance suite and does not weaken capability or budget enforcement.

## 23. Test strategy

### 23.1 Per-service tests

Every repository must cover:

- empty database migration;
- migration from the last supported release;
- invalid/missing secret file;
- health and readiness success/failure;
- SIGTERM during idle and active work;
- volume ownership from a previous image;
- non-root startup;
- amd64 and arm64 image start;
- secret absence from logs and health responses;
- image restart with data retained.

### 23.2 Authentication tests

- initial password bootstrap over stdin;
- password never appears in process args, environment, logs, HTML, or DB plaintext;
- valid/invalid login;
- rate-limit behavior;
- secure cookie flags behind Caddy;
- session expiry and revocation;
- password change invalidates previous sessions;
- password reset recovery;
- unauthenticated page, API, SSE, approval, Server Action, and custom MCP management denial;
- CSRF/origin rejection;
- OAuth callback state validation.

### 23.3 Installer matrix

| Scenario                             | amd64 | arm64                           |
| ------------------------------------ | ----- | ------------------------------- |
| Ubuntu 22.04, Docker absent, domain  | Yes   | Yes                             |
| Ubuntu 24.04, Docker present, domain | Yes   | Yes                             |
| Ubuntu 26.04, Docker absent, private | Yes   | Yes                             |
| Debian 12, Docker absent, private    | Yes   | Yes                             |
| DNS not ready                        | Yes   | one representative architecture |
| Ports 80/443 occupied                | Yes   | one representative architecture |
| Interrupted after secrets            | Yes   | one representative architecture |
| Interrupted during image pull        | Yes   | one representative architecture |
| Re-run same version                  | Yes   | Yes                             |
| Upgrade previous stable              | Yes   | Yes                             |
| Restore backup to clean VPS          | Yes   | Yes                             |
| Uninstall preserving data            | Yes   | one representative architecture |

Use disposable cloud VMs for release candidates. Container-in-container tests are useful for fast feedback but do not replace tests against real systemd, firewall, DNS, and Docker Engine behavior.

### 23.4 End-to-end product test

```text
install stack
  → open HTTPS URL
  → login
  → verify Work/Docs/Runner health
  → authenticate Codex
  → create COO agent
  → create Work project + issue
  → create Docs document
  → run COO review
  → observe streaming/tool calls
  → persist messages/run events
  → restart all containers
  → login and verify state
  → backup
  → restore on clean VPS
  → verify the same state
```

### 23.5 Security tests

- only 80/443 are public in domain mode;
- only 127.0.0.1:3009 is bound in private mode;
- direct host access to Work/Docs/Email/Runner fails;
- Runner rejects unauthenticated requests inside the network;
- Runner can call run-scoped PostHog and Custom Integration tools through `http://slab-agents:3009`, without using the public Caddy route;
- images run without root and without extra capabilities;
- no container has Docker socket access;
- image signatures/digests are verified;
- secrets do not appear in `docker inspect` once `_FILE` adoption is complete;
- secrets do not appear in support bundles, run events, profiling, or browser responses;
- restore archives are mode 0600 and checksum-verified;
- malicious Host/X-Forwarded headers do not bypass origin or secure-cookie logic;
- login and approval endpoints resist rapid replay.

### 23.6 Update tests

- current stable to candidate;
- migration failure before service start;
- one image unavailable;
- health failure after migration;
- compatible automatic rollback;
- incompatible migration requiring backup restore;
- Caddy certificate state preserved;
- Codex auth preserved;
- no duplicate automations/runs after restart.

## 24. Failure-mode table

| Failure                          | Detection                           | User-visible recovery                                | Test                          |
| -------------------------------- | ----------------------------------- | ---------------------------------------------------- | ----------------------------- |
| DNS points elsewhere             | installer + `slabctl domain verify` | print required A/AAAA record; finish as TLS pending  | VPS domain test               |
| Port 80/443 occupied             | preflight socket/process check      | name owning process; stop before mutation            | VPS conflict test             |
| Docker installation fails        | apt exit + daemon status            | preserve install state; rerun after package repair   | disposable VM fault injection |
| Image pull/signature fails       | digest/signature verification       | do not start unverified image                        | release test                  |
| Migration fails                  | one-shot job exit                   | keep old containers/data; show migration logs        | migration fault test          |
| Runner healthy, Codex signed out | `/runtimes`                         | stack ready; prompt `slabctl codex login`            | runtime auth test             |
| Caddy cannot issue certificate   | Caddy logs + HTTPS probe            | TLS pending; diagnose DNS/firewall                   | ACME staging test             |
| Disk fills during pull/backup    | preflight and ongoing checks        | abort before deleting old artifacts                  | low-disk test                 |
| SQLite volume ownership wrong    | readiness + entrypoint              | bounded ownership migration or exact repair command  | upgrade fixture               |
| Active run during update         | run drain status                    | wait, cancel explicitly, or abort update             | lifecycle E2E                 |
| Backup interrupted               | temp filename + atomic rename       | discard incomplete archive; existing state untouched | kill test                     |
| Secret file missing              | service config validation           | name missing secret only, never expected value       | config test                   |
| Optional Email unavailable       | system health                       | UI warning; core stack remains ready                 | dependency isolation test     |
| Invalid admin password attempts  | login rate limiter                  | generic error + retry delay                          | auth integration test         |

No failure in this table may be silent. Each gets a test, structured diagnostic, and recovery action.

## 25. Parallel implementation lanes

| Lane | Work                                                             | Depends on                                          |
| ---- | ---------------------------------------------------------------- | --------------------------------------------------- |
| A    | Slab Agents auth, health, image, secret files                    | Phase 0 contracts                                   |
| B    | Runner image, Codex packaging, network/auth changes              | Phase 0 contracts                                   |
| C    | Work/Docs/Email readiness, migrations, image workflows           | Phase 0 contracts                                   |
| D    | `slab-stack` manifest, Compose templates, installer test harness | Phase 0 contracts; consumes A/B/C artifacts for E2E |
| E    | Documentation, domain hosting, release operations                | Phase 0; final verification waits for D             |

Execution order:

```text
Phase 0
   │
   ├── Lane A ─┐
   ├── Lane B ─┼──► publish candidate images ─► Lane D integration
   └── Lane C ─┘                                  │
                                                  ├──► Lane E release docs/domain
                                                  └──► stable release
```

Lanes A, B, and C can run in separate repositories without merge conflicts. Lane D can build its unit-tested templates in parallel but cannot pass the full release gate until all five candidate images exist.

## 26. Suggested PR sequence

### `slab-agents`

1. `feat(auth): add single-user login and session protection`
2. `build(container): separate migrations and add production image`
3. `feat(ops): add health readiness and admin bootstrap cli`
4. `feat(config): support file-backed internal secrets`
5. `ci: publish signed multi-arch image`
6. `feat(runtime): add web runtime settings and budgets` after installer MVP

### `slab-runner`

1. `feat(config): allow authenticated internal container binding`
2. `build(container): bundle pinned codex and persistent managed home`
3. `feat(ops): add runtime auth diagnostics and graceful shutdown`
4. `ci: publish signed multi-arch image`
5. `feat(runtime): add api and claude adapters` after installer MVP

### `slab`

1. `feat(ops): add deterministic migration and readiness commands`
2. `feat(config): support file-backed api key`
3. `ci: publish signed multi-arch image`

### `slab-docs`

1. `feat(ops): add deterministic migration and readiness commands`
2. `feat(config): support file-backed api key`
3. `ci: publish signed multi-arch image`

### `slab-email`

1. `feat(ops): add readiness graceful shutdown and file-backed secrets`
2. `build(container): harden production compose contract`
3. `ci: publish signed multi-arch image`

### `slab-stack`

1. `feat(release): define signed stack manifest`
2. `feat(compose): add unified private network stack`
3. `feat(installer): add verified interactive bootstrap`
4. `feat(cli): add slabctl lifecycle commands`
5. `test(vps): add clean-host install update restore matrix`
6. `docs: publish install endpoint and operator guide`

Each PR must be independently deployable or explicitly marked as infrastructure groundwork. Do not combine authentication, containerization, installer, and future runtimes into one cross-repository change.

## 27. Release checklist for `v0.1.0`

### Artifacts

- [ ] All five service images published for amd64/arm64.
- [ ] All image packages publicly pullable.
- [ ] Digests, SBOMs, provenance, and signatures present.
- [ ] Stack manifest pins exact digests.
- [ ] Versioned installer bundle signed and checksummed.
- [ ] `https://slab.ar/install.sh` serves the reviewed bootstrap over HTTPS.

### Security

- [ ] Login protects all browser/API/streaming paths.
- [ ] Password bootstrap/reset uses stdin only.
- [ ] Caddy is the only public container.
- [ ] Internal service authentication enabled.
- [ ] Secret files and backups have correct ownership/mode.
- [ ] No Docker socket mount.
- [ ] No secrets in logs, support bundle, HTML, or run events.
- [ ] Container privilege scan passes.

### Operations

- [ ] Fresh install passes on supported OS/architecture matrix.
- [x] Domain and private access modes pass.
- [x] Codex device login passes on a headless VPS.
- [x] Work + Docs + agent run E2E passes.
- [x] Email service is healthy with zero accounts.
- [x] Restart preserves all state.
- [ ] Backup restores on a different clean VPS.
- [ ] Update and rollback paths pass.
- [ ] `slabctl doctor` diagnoses injected failures.
- [ ] Uninstall preserves data by default.

### Documentation

- [ ] Installation guide.
- [ ] DNS and firewall guide.
- [ ] Codex login guide.
- [ ] Gmail OAuth and reachable-mail-server guide.
- [ ] Backup/restore guide.
- [ ] Update/rollback guide.
- [ ] Security model and secret locations.
- [ ] Troubleshooting and support-bundle guide.
- [ ] Resource sizing and supported platforms.

## 28. Definition of done

This initiative is done when a new customer can:

1. provision a supported clean VPS;
2. point a domain A/AAAA record, or choose private access;
3. run the one-line installer;
4. choose an administrator password without storing it in plaintext;
5. open Slab Agents through HTTPS and log in;
6. see Work, Docs, Email, Runner, and Codex health;
7. authenticate Codex through a headless flow;
8. create an agent and complete a Work + Docs run;
9. restart the VPS without losing state;
10. run a backup and restore it on another clean VPS;
11. update to the next stack release without editing Compose manually;
12. diagnose failures with `slabctl doctor` without exposing secrets.

The VPS must not need:

- a source checkout;
- Node/npm on the host;
- Codex installed on the host;
- manual internal API keys;
- public Work/Docs/Email/Runner ports;
- Docker knowledge for normal operation.

## 29. Explicitly not in the first installer release

- multi-user accounts, organizations, SSO, or RBAC;
- Kubernetes or multi-node deployment;
- distributed scheduler or durable job engine;
- Redis, Temporal, or a global queue;
- automatic horizontal scaling;
- LiteLLM or another mandatory model gateway;
- Claude/Kimi native adapters in the `v0.1.0` installer;
- generic web-based host/Caddy/Docker administration;
- Proton Bridge running on a remote user's laptop;
- automatic Gmail OAuth client creation;
- zero-downtime SQLite backups;
- unattended destructive migrations;
- anonymous/public access to Slab Agents.

These exclusions keep the first release a safe single-host product rather than an incomplete platform.

## 30. Reference documentation

- Docker Engine installation on Ubuntu: <https://docs.docker.com/engine/install/ubuntu/>
- Caddy automatic HTTPS: <https://caddyserver.com/docs/automatic-https>
- Caddy with Docker Compose: <https://caddyserver.com/docs/running#docker-compose>
- Codex authentication and headless device login: <https://developers.openai.com/codex/auth>
- Vercel AI SDK `ToolLoopAgent`: <https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent>
- Vercel AI SDK OpenAI-compatible providers: <https://ai-sdk.dev/providers/openai-compatible-providers>
- Claude Code CLI/runtime documentation: <https://docs.anthropic.com/en/docs/claude-code/cli-usage>

## 31. Immediate next action

1. Configure a real Google Web OAuth client from Settings, register the exact
   `https://agents.c5h.dev/api/integrations/email/google/callback` URI, and
   complete one Gmail connection smoke test.
2. Implement and verify backup/restore before adding panel-triggered update
   execution.
3. Add read-only release detection to Settings while the CLI update/rollback
   path is hardened.

Do not publish the `stable` channel until all five images pass the clean-VPS
matrix and backup/restore plus update/rollback have been demonstrated.
