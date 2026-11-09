# Plan: Slab Code (software factory) y Workspaces multi-empresa

Estado: propuesta · 2026-11-09

## 0. Punto de partida (lo que ya existe)

| Pieza | Hoy | Relevancia |
|---|---|---|
| Runner `POST /runs` | acepta `cwd` absoluto, pero el control plane siempre manda `null` (`lib/runner.ts:721-746`, `:942`) | El hook para correr en un repo ya está |
| Codex adapter | `guarded→read-only`, `full→workspace-write`, `yolo→danger-full-access` (`slab-runner/src/adapters/codex-adapter.ts:495-512`) | Hay mapeo de sandbox, falta `writable_roots`/red |
| Approvals de shell/file-change | siempre se reenvían como `approval.required` (`codex-adapter.ts:959-1049`) | Para coding hace falta política automática, si no cada `npm test` pide aprobación |
| Claude adapter | proxy surrogate de la API key (`claude-adapter.ts:427-449`) | Patrón de broker de credenciales ya probado |
| GitHub App | solo lectura para knowledge sources (`lib/sources/github-app.ts`) | Reutilizable para clonar/pushear/PRs ampliando permisos |
| Integraciones | framework MCP por agente con `sensitiveAction` (`lib/integrations/*`) | Las tools de GitHub/PR entran por acá |
| Imagen runner | `node:22-slim` sin git, sin npm, sin toolchain | No puede programar tal cual |
| Tenancy | ninguna: 1 SQLite, 1 clave, settings globales, Work/Docs globales, `integrations.provider` UNIQUE | Multi-empresa por columna = refactor enorme |
| Bridge de host | systemd `.path` + enum cerrado de acciones (`slab-stack/installer/lib/update.sh`) | Sirve para provisionar workspaces, no para cada tarea |

## 1. Decisión de arquitectura

**No construimos otro agente programador.** Slab orquesta Codex / Claude Code / OpenCode
corriendo en un entorno con repo, toolchain y límites.

**slab-code no es un servicio nuevo en v1.** Es:

1. un **perfil de Runner** (`slab-runner-code`): mismo código de Runner, imagen con toolchain
   y un *Workspace Manager* acotado (clone/worktree/cleanup), y
2. un **broker Git/GitHub** dentro de slab-agents (es quien tiene la GitHub App).

Se separa como servicio propio sólo cuando haga falta un pool de VMs/hosts o contenedores
efímeros por tarea (fase 4).

```
slab-agents (control plane)
  ├─ Work issue → run modo "code" → elige repo + runtime + presupuesto
  ├─ GitHub broker: mint de tokens de instalación, push de ramas slab/*, PRs, checks
  └─ MCP "code" para el agente orquestador (start/status/input/cancel)
        │
        ▼  HTTP + SSE (token)
slab-runner-code  (contenedor por workspace, red control, SIN credenciales)
  ├─ /workspaces: createWorkspace / destroyWorkspace (git worktree sobre mirror cacheado)
  ├─ /runs con cwd = worktree, sandbox = el contenedor
  └─ toolchain: git, node+npm/pnpm, python, build-essential, codex, claude-code
```

### Seguridad (no negociable)

- El agente **nunca** ve el token de GitHub ni secretos de producción.
  - Clone/fetch: el broker emite un token de instalación *read-only* de vida corta y lo
    pasa por un credential helper del Workspace Manager, fuera del entorno del agente.
  - Push: lo hace el Workspace Manager (no el agente) cuando el run termina, sólo a
    `slab/<ISSUE>-<runId>`, nunca a la rama default. Rechaza force-push.
  - PR: lo crea slab-agents vía API (tool `create_pull_request` con `sensitiveAction`).
- Merge **siempre humano** en v1 (o branch protection + review obligatoria en GitHub).
- Dentro del contenedor: usuario no root, `no-new-privileges`, cuotas de CPU/RAM/disco,
  timeout de wall-clock por run (hoy no existe en Runner), red de salida permitida para
  instalar dependencias pero sin acceso a la red `control` salvo el Runner.
- Docker socket: sigue sin montarse en ningún lado.

## 2. Modelo de datos (slab-agents)

```
code_repositories   id, github_owner, github_repo, default_branch,
                    setup_command, test_command, lint_command,
                    runtime_profile (codex|claude|opencode), enabled
agent_repositories  agent_id, repository_id, permission (read|branch|pr)
code_tasks          id, run_id, parent_run_id, issue_key, repository_id,
                    base_sha, branch, worktree_id, status
                    (preparing|running|testing|needs_input|pushed|pr_open|merged|failed|abandoned),
                    pr_number, pr_url, diff_stat_json, test_result_json,
                    budget_reservation_id, created_at, finished_at
code_task_artifacts task_id, kind (diff|log|test_report), storage_path, sha256
```

`integrations.provider = 'github'` reutiliza la App de `github_source_apps` pidiendo
`contents:write`, `pull_requests:write`, `checks:read`, `metadata:read`.

## 3. Flujo end-to-end (CleanCut)

1. Growth detecta la página SEO con muchas visitas y pocas descargas y crea un issue en
   Work con la hipótesis y la métrica objetivo.
2. El agente Engineering toma el issue y llama `code_start_task(issueKey, repo, instructions)`.
3. slab-agents crea un `code_task` y le pide a slab-runner-code `createWorkspace` (fetch del
   mirror, worktree en `base_sha`, `setup_command`).
4. Run hijo con `cwd = worktree`, runtime Codex, política de comandos automática dentro
   del worktree y presupuesto propio.
5. Al terminar: `test_command`, diff + logs a artifacts, commit y push de `slab/CC-42-<run>`.
6. slab-agents abre el PR (body con issue, hipótesis, tests) y comenta en el issue.
7. Un agente Reviewer corre con el repo en solo lectura más el diff y deja una review
   (seguridad y regresiones).
8. CI se lee por polling de checks (webhook en fase 3). Si CI falla, el run se reanuda en
   el mismo worktree con el log (máx. N intentos).
9. Merge humano, y después Analytics actualiza el issue con la evidencia.

## 4. Cambios por repo

**slab-runner**
- Endpoints `POST /workspaces`, `DELETE /workspaces/:id`, `GET /workspaces/:id/diff`,
  habilitados sólo con `RUNNER_WORKSPACES_ROOT`. Operaciones git cerradas, sin exec
  arbitrario: `setup` y `test` vienen del registro del repo, no del agente.
- Validar que `cwd` esté bajo `RUNNER_WORKSPACES_ROOT`.
- Política de approvals para `command` y `file_change`: `approve` si el cwd está dentro
  del worktree, `prompt` en el resto de los casos.
- Codex: `sandbox_workspace_write.writable_roots=[worktree]`, red configurable.
- Timeout por run y límite de concurrencia (`RUNNER_MAX_ACTIVE_RUNS`).
- **Perfiles de auth** (ver §5): registro `profileId → {CODEX_HOME, app-server, auth manager, gate}`.
- `Dockerfile.code` con toolchain.

**slab-agents**
- Migraciones del §2, integración `github` (catálogo, service, MCP), broker de tokens.
- `RunExecution.mode = "code"`, que arma `cwd` y elige el runner code.
- MCP `code` para orquestadores: `start_task`, `get_task`, `send_input`, `cancel_task`.
- UI: tab "Code" en el issue o run (diff, tests, link al PR, estado de CI).

**slab-stack**
- Servicio `slab-runner-code` en el perfil `code`, con volumen `code_workspaces` y
  `code_cache` (mirrors, caché de npm) y límites de recursos.
- Acción de bridge `install_code` (igual que `install_whatsapp`).

## 5. Workspaces multi-empresa (clasificar + cleancut en un server)

### Opción elegida: instancia por workspace e infraestructura compartida

Agregar `workspace_id` a las ~45 tablas de slab-agents, y además a Work, Docs y Email
(que también son globales), es un refactor de meses con riesgo de fugas entre empresas.
La alternativa es tratar cada empresa como un **proyecto Compose propio**:

```
/opt/slab/workspaces/<slug>/         (cleancut, clasificar)
  compose project slab-<slug>: slab-agents, slab-api, slab-mcp, slab-docs, slab-email,
                               [slab-runner-code], volúmenes y secretos propios
compartido (proyecto slab-shared):
  caddy          → cleancut.slab.example.com / clasificar.slab.example.com
  slab-runner    → un proceso, varios perfiles de auth
  honcho         → un deploy, workspace id distinto por empresa
```

- Aislamiento fuerte de datos gratis: otra DB, otra clave de cifrado, otras integraciones.
- **Setup compartido u opcional por separado:** cada workspace referencia un `runtime
  profile` del Runner compartido, `shared` (el login de Codex actual) o propio (`cleancut`,
  con su `CODEX_HOME`). Lo mismo para la API key de Claude: compartida vía `slabctl`, o
  cargada en el workspace.
- Cada workspace tiene su token de Runner. El Runner valida que el token pueda usar ese
  perfil y namespacea `runId` y `workspaces` por tenant.
- Costo: unos 600-900 MB de RAM por workspace. Bien para 2-3 empresas en un VPS de 8 GB.
- `slabctl workspace create|list|remove <slug>` y switcher en la UI (links entre
  instancias; el login puede compartir la contraseña de admin vía secret compartido).

Se migraría a tenancy por columna sólo si Slab pasa a SaaS multi-cliente.

## 6. Fases

| Fase | Alcance | Criterio de listo |
|---|---|---|
| 1. Coding MVP | §2-§4 sin reviewer ni CI loop, 1 repo de CleanCut, Codex | Un issue de Work termina en PR abierto con tests corridos, sin intervención salvo aprobar el PR |
| 2. Workspaces | §5: stack multi-proyecto, perfiles de auth en Runner, `slabctl workspace` | clasificar y cleancut corriendo en el mismo server, con Codex compartido y uno propio probados |
| 3. Calidad del loop | Reviewer agent, checks de CI, reintento con logs, webhooks GitHub | PR con CI rojo se corrige solo hasta N veces |
| 4. Fábrica en paralelo | N tasks concurrentes, prioridades y dependencias de Work, presupuesto por task, contenedor efímero por task (pool o gVisor) | 10 cambios en paralelo sin coordinar a mano |
