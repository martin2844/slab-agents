# Plan: Coding (AI software factory en Slab)

Estado: implementado (C0–C5) en `feat/coding` · 2026-11-09 · Guía de uso: [docs/coding.md](../../coding.md)

> Cambios posteriores: multi-repo por run (`code_run_repositories`, migración `202611100001`) y dos agentes por defecto (Code PM y Engineer); el prompt de cada etapa viaja con cada run como instrucciones de la etapa.
>
> Diferencias con la propuesta: el runner-code está en la red `control` (riesgo aceptado, sin gateway MCP); los agentes de etapa se crean desde Coding → Settings en lugar de un blueprint; el estado del PR y del CI se lee por polling cada 2 minutos.
Base: el pipeline del Hub (`hub-code-2026-10-27`), adaptado a Slab Work, Slab Agents y
[slab-runner-code](../../../../slab-runner/docs/plans/slab-runner-code.md).

## 1. Qué es

Una sección **Coding** en Slab. Un **coding run** arranca desde un Work item, se conecta a
**un repo de GitHub** y pasa por estas etapas:

```
PM → Tech spec → Plan review → Engineer → Code review → [Publish: push + draft PR] → Final pass │ PR feedback (on demand) · Run chat
```

Cada etapa es un **run normal de Slab**, ejecutado por un **agente normal de Slab**, en el
runner-code y dentro del workspace del coding run. Con eso se reutiliza todo lo que ya existe:

- runner, eventos y SSE;
- approvals;
- budgets y costo;
- threads y conversación;
- política de tools MCP;
- instrucciones y modelo por agente.

Lo nuevo es el **orquestador** que encadena etapas y aplica gates, la integración con
GitHub, y la UI.

## 2. Diferencias con el Hub

| Hub | Slab Coding |
|---|---|
| Jira, Slack, Datadog y gateway de DataCamp | **Slab Work** (issue, comentarios, links), **Slab Docs** e integraciones asignadas al agente |
| opencode serve con modelos de OpenRouter | **Runner-code con Codex** (login de ChatGPT); modelo y esfuerzo por agente o etapa |
| `question` tool de opencode | La etapa termina con `status: needs_input` y preguntas. El usuario responde en el chat de la etapa y el mismo thread se reanuda. |
| Archivos en `~/hub/runs/<id>/` | Handoff en `<workspace>/handoff/`, fuera del repo. Al terminar la etapa se copia a la DB (`code_run_artifacts`). |
| Worktrees en `~/hub/worktrees` | Workspace del runner-code: clone propio y rama `slab/<issue>-<n>` creada por Slab |
| El bot hace `git push` y `gh pr create` | **El agente nunca pushea.** Slab publica (runner-code) y abre el PR (GitHub App) tras el gate |
| `gh pr edit` en final pass | El agente escribe `pr-body.md` y Slab lo aplica por API |
| Varios repos por run | **Varios repos por run** (hasta 5): un workspace por repo con la misma rama, handoff en el repo primario, un PR draft por repo con cambios. |
| Jev para elegir modelo | Fuera de v1. El modelo es el del agente de la etapa, con override por run. |
| Screenshots y SonarCloud | Fuera de v1. CI se lee por la API de checks de GitHub. |

## 3. Modelo de datos (migración `2026111000xx_coding.cjs`)

```
code_repositories
  id, source_app_id → github_source_apps.id, owner, name, default_branch,
  setup_command, test_command, lint_command, typecheck_command,
  setup_notes (md, lo mantiene el engineer), work_project_key (repo por defecto del proyecto),
  enabled, created_at, updated_at

code_runs
  id, number (secuencial, "#4"), issue_key, title, repository_id,
  status: active | waiting | done | failed | cancelled,
  current_stage, workspace_id, branch, base_sha,
  pr_number, pr_url, pr_state (draft|open|merged|closed), ci_state,
  stage_overrides_json (modelo y agente por etapa), started_at, finished_at

code_run_stages
  id, code_run_id, stage, attempt, status:
    queued | running | needs_input | waiting_approval | done | failed | cancelled | skipped
  agent_id, thread_id, last_run_id → runs.id, verdict, summary,
  cost_usd, tokens_in, tokens_out, started_at, finished_at

code_run_artifacts
  id, code_run_id, stage, attempt, name (spec.md, plan.attempt-2.md, ...), content, created_at
```

- Costo y tokens se agregan desde `runs.usage_json` de cada run de la etapa.
- `runs` gana `code_run_stage_id` (nullable) para el vínculo inverso, más el modo `code_stage` en `RunMode`.

## 4. Agentes de etapa

Un blueprint oficial nuevo, **"Software Factory"** (`lib/packs/catalog.ts`), crea siete agentes:

| Agente | Etapa(s) | Modelo sugerido | Permisos |
|---|---|---|---|
| PM | pm | Codex, el mejor modelo, esfuerzo high | Work: leer y comentar; Docs: leer |
| Tech Lead | tech_spec | Codex high | Work y Docs: leer |
| Plan Reviewer | plan_review | Codex xhigh (otro esfuerzo o modelo que el Tech Lead) | Work y Docs: leer |
| Engineer | engineer | Codex medium | Work: leer |
| Code Reviewer | code_review | Codex high | Work: leer |
| Release Writer | final_pass | Codex low | Work: leer |
| PR Fixer | pr_feedback, chat | Codex medium | Work: leer |

- El prompt de cada etapa (`prompts/`) va en las instrucciones del agente: el operador puede
  editarlo como cualquier agente.
- El **contrato** de la etapa (paths de handoff, formato de salida y reglas de git) lo
  inyecta el orquestador en el mensaje del run. Así editar el agente no rompe el pipeline.
- Settings → Coding guarda el mapping `etapa → agente`. Por defecto son los del blueprint.

## 5. Orquestador (`lib/coding/`)

```
lib/coding/
  stages.ts          definición de etapas: id, nombre, inputs, output, gate, autoRetries
  orchestrator.ts    tick (cada 3 s, como work-coordination): avanza runs activos
  stage-runner.ts    arma el mensaje de etapa y crea el run (createRunExecution, mode code_stage)
  handoff.ts         lee el handoff del runner-code, parsea el frontmatter y lo guarda
  github.ts          tokens de instalación, PRs, checks, comentarios (sobre lib/sources/github-app.ts)
  publish.ts         finalize y publish en el runner-code, y crear o actualizar el draft PR
  work-sync.ts       comentarios y status en el Work issue
  repository.ts      acceso a datos
```

### Definición de etapas

| Etapa | Inputs | Output | Gate al terminar |
|---|---|---|---|
| `pm` | issue de Work (get_issue y comentarios), `run.md` | `spec.md` | **approve**: el usuario aprueba el spec o responde en el chat |
| `tech_spec` | `spec.md` (+ `review.md` si es reintento) | `plan.md` | auto |
| `plan_review` | `spec.md`, `plan.md` | `review.md` | **verdict**: con `pass` avanza. Con `fail` vuelve a tech_spec con los ítems fallidos, máx. 2 automáticos; después espera al usuario. |
| `engineer` | `spec.md`, `plan.md`, `review.md` | commits y `engineer.md` | auto, si `checks: pass` |
| `code_review` | `spec.md`, `plan.md`, `engineer.md` | fixes y `code-review.md` | **approve publish**: muestra el diff y "Publicar" hace push + draft PR |
| `publish` | (no es agente) | rama en GitHub y draft PR | automático tras la aprobación |
| `final_pass` | `spec.md`, `engineer.md`, `code-review.md` y diff | `pr-body.md` y `final.md` | auto; Slab aplica el body al PR |
| `pr_feedback` | `feedback-items.json` (lo escribe Slab desde GitHub) | `feedback-triage.json`; tras aprobar, commits y `feedback-result.json` | approve publish y respuestas |
| `chat` | todos los artifacts | respuestas; cambios opcionales | "Publicar cambios" manual |

### Reglas del orquestador

1. **Salida obligatoria.** Cuando un run de etapa termina, el orquestador lee `handoff/<output>`.
   Si falta o no tiene frontmatter válido, reintenta en el mismo thread con el motivo (máx. 2,
   como en el Hub). Si la etapa la frenó el usuario, no reintenta.
2. **`status: needs_input`**: la etapa queda en `needs_input` y las preguntas del frontmatter y
   el cuerpo se muestran en la etapa. Una respuesta del usuario crea un run nuevo en el mismo
   thread (thread reusable, como el modo chat).
3. **Re-run from here**: invalida esta etapa y las siguientes (quedan como attempts viejos) y re-encola.
4. **Una etapa a la vez por coding run** (el lock del workspace lo garantiza también en el runner).
5. **Paralelismo entre coding runs**: lo limita `RUNNER_MAX_ACTIVE_RUNS` del runner-code; el resto queda `queued`.
6. **Budget por coding run**: tope opcional en USD. Lo verifica el admit de budget existente antes de cada etapa.

### Mensaje de etapa (lo genera el orquestador)

```
Coding run #4 · Work item CC-42 · Stage: tech_spec (attempt 2)
Repository: cleancut/web (default branch main) · Branch: slab/cc-42-4 · Checkout: /var/lib/slab-code/workspaces/ws_…/repo
Handoff folder: /var/lib/slab-code/workspaces/ws_…/handoff
Inputs: spec.md, review.md (read them from the handoff folder)
Write your output to: handoff/plan.md
Repo commands: setup `pnpm i` · test `pnpm test` · lint `pnpm lint` · typecheck `pnpm tsc --noEmit`
Repo setup notes: <setup_notes>
Retry reason: <failed rubric items / missing output>
Rules: no git push, no PR creation, no edits under .github/workflows.
```

## 6. GitHub

- Se reutiliza la **GitHub App** de Sources (`lib/sources/github-app.ts`). El manifest pasa de
  `contents: read` a `contents: write`, y se suman `pull_requests: write`, `checks: read`,
  `issues: read` y `metadata: read`.
  - **No se pide `workflows`**, a propósito: así GitHub rechaza pushes del agente que toquen CI.
  - Las Apps ya creadas necesitan aceptar los permisos nuevos en GitHub; la UI muestra el aviso.
- Tokens de instalación con vida de 1 h: uno para fetch al crear el workspace y otro para el
  push al publicar.
- PR: `POST /repos/{o}/{r}/pulls` con `draft: true`. Título `[CC-42] <title>`; body inicial
  del code review, reemplazado en final pass. Trailer con link al coding run.
- Estado: polling cada 2 min de los PRs abiertos (pr_state, checks y reviews). Webhooks después.
- **Branch protection en `main` del repo**: se recomienda en el onboarding del repo. Slab
  nunca mergea.

## 7. Sync con Work

| Momento | Acción en el issue |
|---|---|
| Arranca el coding run | Status `in_progress` y comentario "Coding run #4 started · repo · link" |
| PM aprobado | Comentario con el resumen del spec (lo hace el agente PM vía Work MCP) |
| Draft PR abierto | Comentario con el link al PR y status `review` |
| PR mergeado | Status `done` y comentario |
| Run fallido o cancelado | Comentario con el motivo; el status no se cambia |

## 8. UI

**Navegación**: un ítem nuevo, **Coding**, en el grupo Operate, entre Work y Agents.

**`/coding` (lista)**

- Tabla: `#`, issue, título, repo, una mini tira de etapas, etapa actual y estado, costo,
  duración, PR (estado y CI) y fecha.
- Filtros: activos, esperando, terminados.
- Badge en la nav con la cantidad de runs `waiting` (needs_input, waiting_approval).
- Botón **New coding run**: elegir un Work item y un repo.

**`/coding/[id]` (detalle, como el screenshot del Hub)**

1. **Header**: `#4 CC-42 — título`, estado, link al issue, repo, link al PR, inicio, costo
   total y tiempo total.
2. **Tira de etapas**: ícono, nombre, duración, costo y modelo; estado con color. Click
   selecciona la etapa. PR feedback y Run chat aparecen separados a la derecha.
3. **Card de Pull request**: repo, número, estado, checks, `+/-`, archivos y rama. Botones
   *Open PR*, *Files changed*, *Checks*, *PR feedback* y *Refresh*.
4. **Panel de etapa**:
   - Agente, estado y descripción. Botones según estado: *Approve*, *Request changes*,
     *Re-run from here*, *Stop* y *Publish*.
   - Modelo (override), tiempo, tokens y costo.
   - Tabs: **Activity** (tool calls mapeados, reutiliza `run-detail`), **Output** (artifact
     renderizado) y **Conversation** (`thread-chat` del thread de la etapa, para responder preguntas).
5. **Files**: lista de artifacts con hora y versiones por attempt (`plan.attempt-1.md`, ...).

**Desde Work**: en el detalle del issue (`work-board.tsx`), un botón **Start coding run**
abre un diálogo con el repo (preseleccionado por `work_project_key`), una nota opcional y
overrides de modelo. Si el issue ya tiene coding runs, se muestran con link.

**Settings → Coding**:

- Conexión al runner-code: estado y login de Codex, reutilizando `codex-auth-settings`
  contra el segundo runner.
- **Repositorios**: elegir una GitHub App y un repo instalado, branch default, comandos, notas
  de setup y proyecto de Work por defecto. El botón "Test" crea un workspace, corre el setup
  y lo destruye.
- Mapping `etapa → agente`, auto-retries y budget por run.

## 9. Runner

- `lib/runner.ts`: si `run.mode === "code_stage"`, se usa el **code runner**
  (`code_runner_url` más el token propio) y se manda `workspace: { id }` en lugar de `cwd`.
- Las MCP de Work y Docs se pasan vía el gateway de slab-agents (el runner-code no ve la
  red `control`). Primera versión: rutas `/api/code/mcp/work` y `/api/code/mcp/docs` con token por run.
- Endpoint extra del runner-code para leer el handoff:
  `GET /workspaces/:id/handoff/:name`, más el path `handoff/` como writable root.
  Se agrega a su plan.

## 10. Milestones

| M | Contenido | Listo cuando |
|---|---|---|
| **C0** | runner-code, pasos 1-3 de su plan, más handoff | Workspace, run de Codex con workspace y lectura del handoff |
| **C1** | Migración, repositorio y repos en Settings, permisos de la GitHub App, nav Coding, lista y detalle vacíos, "Start coding run" desde Work | Se crea un coding run desde un issue y se ve en `/coding` |
| **C2** | Orquestador y etapas PM, Tech spec y Plan review (sin cambios de código), `needs_input` y chat, approve del spec, retry loop del plan, artifacts | Un issue real termina con un plan aprobado por el reviewer |
| **C3** | Engineer, Code review, Publish (push + draft PR) y sync con Work | Primer draft PR real en CleanCut |
| **C4** | Final pass (body del PR), polling de PR y CI, merged → done, costo y tiempo en el header | Pipeline completo como el Hub |
| **C5** | PR feedback (ledger, triage, apply, replies) y Run chat con publicar cambios | Loop de review humano cerrado |

C1 y C0 se pueden hacer en paralelo: C1 no ejecuta nada.

## 11. Prompts

Están en [`prompts/`](prompts/), adaptados del Hub: sin Jira, DataCamp gateway ni `gh`; con
Slab Work, Docs, el handoff y las reglas de git de Slab. Al implementarlos pasan a
`lib/packs/catalog.ts` (blueprint) y `lib/coding/stages.ts` (contrato).
