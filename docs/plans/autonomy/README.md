# Plan: niveles de autonomía y Telegram

Estado: implementado (fases A–F) · 2026-11-10 · Guía de uso: [docs/autonomy.md](../../autonomy.md) · Piloto: cleancut.video en una VPS nueva (sin multi-tenant)

## 1. Objetivo

Slab gana un **nivel de autonomía** configurable. El nivel es un preset; cada capacidad se puede ajustar
por separado. El humano habla con el equipo por **Telegram**: recibe avisos, aprueba, contesta preguntas
y puede pausar todo.

Regla principal: **no romper lo que existe.** Una instalación sin configuración nueva queda en el nivel 1,
y el nivel 1 se comporta exactamente como Slab hoy.

## 2. Niveles

| Nivel | Nombre | Qué hacen los agentes | Qué decide el humano |
|---|---|---|---|
| 0 | Manual | Solo responden cuando el humano los usa (chat, run manual). No corre ninguna automatización, trigger de Work ni ciclo. | Todo. |
| 1 | Reactivo (**default, = hoy**) | Automatizaciones (cron, email, WhatsApp) y triggers de Work, con las políticas de herramientas de cada agente. | Lo que piden las políticas: aprobaciones en la web, avisos por email. |
| 2 | Supervisado | Nivel 1 + planifican solos (ciclo del agente jefe), se agendan seguimientos, piden ayuda por Telegram, lanzan coding runs y proponen automatizaciones o agentes nuevos como borrador. | Aprobar spec y publicación de PRs, activar borradores, outbound a contactos nuevos. Todo desde Telegram. |
| 3 | Autónomo (cleancut) | Nivel 2 sin gates: publican PRs draft listos, crean y activan automatizaciones, hacen outreach con topes. Las aprobaciones de herramientas se resuelven solas, salvo las líneas rojas. | Solo las líneas rojas y lo que el equipo pregunta con `ask_human`. Revisar y mergear PRs, hacer builds. |

**Líneas rojas** (humanas en todos los niveles, no configurables): mergear o pushear a la rama por defecto,
publicar releases, mover dinero o cambiar planes de pago, borrar datos en masa, cambiar integraciones,
credenciales, presupuestos o permisos, y subir el propio nivel de autonomía.

## 3. Capacidades configurables

El nivel define un valor para cada capacidad. En **Settings → Autonomía** cada una se puede fijar a mano
(más o menos estricta que el preset). Un agente puede tener un **tope** de nivel más bajo que el
workspace (por ejemplo, la agente de WhatsApp de clientes en nivel 1).

| Capacidad | Valores | N0 | N1 | N2 | N3 |
|---|---|---|---|---|---|
| `triggers` — automatizaciones y triggers de Work | off / on | off | on | on | on |
| `planning` — ciclo del agente jefe | off / on (cada N horas + resumen diario) | off | off | on | on |
| `followups` — el agente agenda seguimientos | off / on | off | off | on | on |
| `ask_human` — preguntas al humano | off / on | off | off | on | on |
| `self_manage` — crear o cambiar automatizaciones y agentes | off / draft / auto | off | off | draft | auto |
| `delegate` — lanzar runs de otros agentes | off / on | off | off | on | on |
| `coding_start` — quién lanza coding runs | human / agent / on_assign | human | human | agent | on_assign |
| `coding_gates` — spec y publicación | human / auto | human | human | human | auto |
| `outbound` — email o WhatsApp a contactos nuevos | off / approval / auto | off | política del agente | approval | auto (con tope) |
| `tool_approvals` — aprobaciones de herramientas | policy / auto | policy | policy | policy | auto (excepto líneas rojas) |
| `approval_timeout` — aprobación sin respuesta | wait / escalate / deny | wait | wait | escalate | escalate → deny |

En el nivel 1 todas las capacidades nuevas quedan en `off` y las existentes siguen su configuración
actual. Por eso el nivel 1 = hoy.

## 4. Telegram (canal del operador)

- Corre dentro de slab-agents: no hace falta un contenedor nuevo. Usa long polling, así que funciona en
  modo privado, sin dominio ni webhook.
- **Vinculación:** se pega el token del bot en Settings y se manda `/start <código>` desde tu cuenta. Solo
  ese chat queda autorizado. Los mensajes de cualquier otro chat se ignoran.
- **Salidas:** los avisos de hoy (aprobación pendiente, run fallido, trabajo bloqueado, integración caída)
  como canal además del email. Aprobaciones con botones Aprobar / Rechazar y el detalle exacto de la acción.
  Preguntas de `ask_human` con opciones. PRs listos para revisar. Resumen diario.
- **Entradas:**
  - Responder a un mensaje contesta esa pregunta o aprobación.
  - `/estado` resume runs activos, pendientes y gasto del día.
  - `/pausa` baja el workspace a nivel 0 al instante y `/reanudar` lo devuelve al nivel anterior.
  - `/tarea <texto>` crea un Work item para el agente jefe.
  - Un mensaje libre va al chat del agente jefe.

## 5. Piezas nuevas

1. **Política** (`lib/autonomy/`): niveles, capacidades, resolución efectiva por agente y auditoría de cada
   cambio. Un solo chequeo (`autonomy.allows(capability, agent)`) en los puntos de disparo: scheduler,
   automatizaciones de email y WhatsApp, coordinador de Work, coding.
2. **Telegram** (`lib/telegram/`): bot, vinculación, notificaciones, botones y comandos.
3. **`ask_human`:** la pregunta queda en `human_requests` (opciones, urgencia, timeout, respuesta por
   defecto). El run termina en vez de quedarse esperando; la respuesta abre un run de continuación en el
   mismo thread. Así no se bloquea la cola del agente.
4. **Seguimientos:** las tools `schedule_followup` y `wake_me_at` guardan entradas en `agent_wakeups`, y el
   scheduler las despacha.
5. **Agente jefe y ciclo:** un agente marcado como jefe corre cada N horas. Mira Work, inbox, métricas y
   PRs, decide y asigna. También manda un resumen diario por Telegram.
6. **MCP `slab-control`:** tools para listar, crear y editar automatizaciones y agentes, lanzar runs y
   coding runs, y pedir ayuda. Solo se adjunta a los agentes cuyo nivel lo permite. En modo `draft` lo
   creado queda deshabilitado y llega un aviso a Telegram para activarlo. Nunca toca niveles, permisos,
   presupuestos, integraciones ni secretos.
7. **Coding autónomo:**
   - con `on_assign`, asignar un Work item al Engineer lanza el coding run;
   - con `coding_gates: auto`, el spec se aprueba solo y la publicación también, si el review da
     `ready: true` y los checks pasan;
   - el PR draft llega por Telegram;
   - los builds de Mac, Windows y Linux corren en GitHub Actions del repo de cleancut.
8. **Frenos (aplican desde el nivel 2):**
   - límite global de runs concurrentes;
   - límite de tiempo por run;
   - profundidad máxima de cadenas entre agentes (linaje de los triggers de Work);
   - presupuesto diario bajo al principio;
   - topes diarios de outbound.
9. **Memoria:** con la capacidad activa, también se escribe desde los runs autónomos, no solo desde chat.

## 6. Compatibilidad

- **Sin configuración, nivel 1:** si la setting no existe, el nivel es 1. Ese camino de código no cambia; los
  tests actuales y un test nuevo ("el nivel 1 equivale a hoy") lo cubren.
- **Migraciones aditivas:** tablas y columnas nuevas con defaults, sin renombrar ni borrar nada.
- **Telegram y `slab-control` apagados por defecto:** sin token, Telegram no arranca; `slab-control` no se
  adjunta en los niveles 0 y 1.
- **agents.c5h.dev puede recibir los mismos deploys:** queda en nivel 1, sin cambios visibles salvo la
  pantalla nueva de Settings.

## 7. Fases

| Fase | Entrega | Se puede probar en |
|---|---|---|
| A | Política de autonomía, niveles 0 y 1, Settings → Autonomía, `/pausa` en la API | prod actual (sigue en 1) |
| B | Telegram: vinculación, avisos, aprobaciones con botones, `/estado`, `/pausa`, `/reanudar` | VPS nueva |
| C | `ask_human`, seguimientos, agente jefe y ciclo, memoria desde todos los runs, frenos | VPS nueva, nivel 2 |
| D | Coding autónomo (`on_assign`, gates automáticos, aviso del PR) y workflow de builds | VPS nueva, nivel 2 → 3 |
| E | `slab-control`: autogestión en modo draft y después auto | VPS nueva, nivel 3 |
| F | Soporte (adjuntos, HTML, vínculo hilo ↔ Work) y outreach (casilla y dominio aparte, leads en Work, opt-out, topes) | VPS nueva, nivel 3 |

## 8. VPS nueva

- 4 vCPU, 8–16 GB de RAM, 80 GB o más de disco: el stack completo, el code runner y clones con dependencias.
- Instalación nueva con el instalador de slab-stack en modo dominio (por ejemplo `slab.cleancut.video`).
- Su propio login de Codex. Las cuotas del plan de ChatGPT van a ser el límite real de un equipo que
  corre todo el día.
- Una GitHub App propia para los repos de cleancut y una casilla de soporte en `cleancut.video`. El
  outreach va con otro dominio o subdominio.
