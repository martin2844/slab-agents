import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { badRequest, conflict } from "@/lib/api";
import { autonomyRepository } from "@/lib/repositories/autonomy-repository";
import { telegramRepository } from "@/lib/repositories/telegram-repository";
import { settingsRepository } from "@/lib/repositories/settings-repository";
import { agentRepository } from "@/lib/repositories/agent-repository";
import { conversationRepository } from "@/lib/repositories/conversation-repository";
import { runRepository } from "@/lib/repositories/run-repository";
import { approvalRepository } from "@/lib/repositories/approval-repository";
import { decryptLocalSecret, encryptLocalSecret } from "@/lib/secrets";
import { configuredPublicOrigin } from "@/lib/request-origin";
import { resolveApprovalAction } from "@/lib/approval-resolution";
import { createRunExecution, executeRunInBackground } from "@/lib/run-service";
import {
  getAutonomyPolicy,
  logAutonomyEvent,
  pauseAutonomy,
  resumeAutonomy,
  updateAutonomyPolicy,
} from "@/lib/autonomy/service";
import { LEVEL_INFO, isAutonomyLevel } from "@/lib/autonomy/policy";
import { answerHumanRequest, getHumanRequest, listHumanRequests } from "@/lib/autonomy/human-requests";
import { decideProposal, listProposals } from "@/lib/autonomy/proposals";
import { startAutonomyRun } from "@/lib/autonomy/runs";
import { codingRepository } from "@/lib/repositories/coding-repository";
import { STAGE_DEFINITIONS } from "@/lib/coding/stages";
import {
  TelegramApi,
  type InlineButton,
  type TelegramCallbackQuery,
  type TelegramMessage,
  type TelegramUpdate,
} from "@/lib/telegram/api";

const CONFIG_KEY = "telegram_config";
const LINK_CODE_TTL_MS = 30 * 60_000;
const TERMINAL = new Set(["completed", "failed", "skipped", "cancelled"]);

type StoredConfig = {
  tokenCiphertext?: string;
  botId?: number;
  botUsername?: string;
  chatId?: string | null;
  chatName?: string | null;
  linkedAt?: string | null;
  linkCodeHash?: string | null;
  linkCodeExpiresAt?: string | null;
  offset?: number;
  lastError?: string | null;
  lastPollAt?: string | null;
  leadThreadId?: string | null;
};

function readConfig(): StoredConfig {
  const raw = settingsRepository.get(CONFIG_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as StoredConfig;
  } catch {
    return {};
  }
}

function writeConfig(patch: Partial<StoredConfig>) {
  const next = { ...readConfig(), ...patch };
  settingsRepository.set(CONFIG_KEY, JSON.stringify(next));
  return next;
}

function hashCode(code: string) {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

export function telegramApi() {
  const config = readConfig();
  if (!config.tokenCiphertext) return null;
  return new TelegramApi(decryptLocalSecret(config.tokenCiphertext));
}

export type TelegramStatus = {
  configured: boolean;
  botUsername: string | null;
  linked: boolean;
  chatName: string | null;
  linkedAt: string | null;
  lastError: string | null;
  lastPollAt: string | null;
  linkPending: boolean;
};

export function getTelegramStatus(): TelegramStatus {
  const config = readConfig();
  return {
    configured: Boolean(config.tokenCiphertext),
    botUsername: config.botUsername ?? null,
    linked: Boolean(config.chatId),
    chatName: config.chatName ?? null,
    linkedAt: config.linkedAt ?? null,
    lastError: config.lastError ?? null,
    lastPollAt: config.lastPollAt ?? null,
    linkPending: Boolean(config.linkCodeHash && config.linkCodeExpiresAt && config.linkCodeExpiresAt > now()),
  };
}

function newLinkCode() {
  const code = randomBytes(5).toString("hex").toUpperCase();
  writeConfig({ linkCodeHash: hashCode(code), linkCodeExpiresAt: new Date(Date.now() + LINK_CODE_TTL_MS).toISOString() });
  return code;
}

/** Saves the bot token (checked with Telegram) and returns a one-time code to link your chat. */
export async function configureTelegram(token: string) {
  const trimmed = token.trim();
  if (!/^\d{5,16}:[A-Za-z0-9_-]{30,}$/.test(trimmed)) throw badRequest("This does not look like a Telegram bot token.");
  const api = new TelegramApi(trimmed);
  const me = await api.getMe();
  // Slab reads updates with long polling, so the bot must not have a webhook.
  await api.deleteWebhook().catch(() => undefined);
  const previous = readConfig();
  writeConfig({
    tokenCiphertext: encryptLocalSecret(trimmed),
    botId: me.id,
    botUsername: me.username,
    // A different bot cannot inherit the linked chat.
    ...(previous.botId && previous.botId !== me.id ? { chatId: null, chatName: null, linkedAt: null, offset: 0 } : {}),
    lastError: null,
  });
  logAutonomyEvent({ kind: "telegram_configured", actor: "operator", summary: `Telegram bot @${me.username ?? me.id} configured.` });
  return startLinking();
}

export function startLinking() {
  const config = readConfig();
  if (!config.tokenCiphertext) throw conflict("Save the bot token first.");
  const code = newLinkCode();
  return {
    code,
    botUsername: config.botUsername ?? null,
    linkUrl: config.botUsername ? `https://t.me/${config.botUsername}?start=${code}` : null,
    expiresAt: readConfig().linkCodeExpiresAt,
  };
}

export function disconnectTelegram() {
  settingsRepository.set(CONFIG_KEY, JSON.stringify({}));
  logAutonomyEvent({ kind: "telegram_disconnected", actor: "operator", summary: "Telegram disconnected." });
}

function link(pathname: string) {
  const origin = configuredPublicOrigin();
  return origin ? `${origin.replace(/\/$/, "")}${pathname}` : pathname;
}

const now = () => new Date().toISOString();
const recordMessage = telegramRepository.recordMessage;

/** Sends a message to the linked chat. Returns null when Telegram is not linked. */
export async function sendToOperator(input: {
  text: string;
  kind: string;
  refId?: string | null;
  buttons?: InlineButton[][];
  replyTo?: number | null;
}) {
  const config = readConfig();
  const api = telegramApi();
  if (!api || !config.chatId) return null;
  const message = await api.sendMessage({ chatId: config.chatId, text: input.text, buttons: input.buttons, replyTo: input.replyTo });
  recordMessage(config.chatId, message.message_id, input.kind, input.refId ?? null);
  return message;
}

async function reply(chatId: string, text: string, replyTo?: number, buttons?: InlineButton[][]) {
  const api = telegramApi();
  if (!api) return;
  await api.sendMessage({ chatId, text, replyTo: replyTo ?? null, buttons });
}

// ---------------------------------------------------------------------------
// Incoming updates

const HELP = [
  "Comandos:",
  "/estado — resumen del equipo",
  "/pausa — frena todo lo automático (nivel 0)",
  "/reanudar — vuelve al nivel anterior",
  "/nivel 0-3 — cambia el nivel de autonomía",
  "/tarea <texto> — le da una tarea al agente líder",
  "/preguntas — preguntas sin responder",
  "",
  "Respondé a un mensaje para contestar una pregunta o pedir cambios en un coding run. Cualquier otro mensaje va al agente líder.",
].join("\n");

export function statusText() {
  const policy = getAutonomyPolicy();
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const counts = telegramRepository.statusCounts(since);
  const lines = [
    `Nivel ${policy.level} · ${LEVEL_INFO[policy.level].name}${policy.paused ? ` (en pausa, nivel guardado ${policy.configuredLevel})` : ""}`,
    `Runs: ${counts.running} corriendo · ${counts.queued} en cola · ${counts.waitingApproval} esperando aprobación`,
    `Preguntas sin responder: ${listHumanRequests({ status: "pending" }).length} · Propuestas: ${listProposals({ status: "pending" }).length}`,
    `Coding runs abiertos: ${codingRepository.listOpenRuns().length} · esperando: ${codingRepository.countWaitingRuns()}`,
    `Últimas 24 h: ${counts.runsSince} runs · ${counts.failedSince} fallidos · US$ ${(counts.costMicroUsdSince / 1e6).toFixed(2)}`,
  ];
  return lines.join("\n");
}

function leadAgent() {
  const policy = getAutonomyPolicy();
  const agent = policy.leadAgentId ? agentRepository.getAgent(policy.leadAgentId) : null;
  return agent?.enabled ? agent : null;
}

async function chatWithLead(chatId: string, message: TelegramMessage, text: string) {
  const agent = leadAgent();
  if (!agent) {
    await reply(chatId, "No hay un agente líder activo. Elegilo en Settings → Autonomía.", message.message_id);
    return;
  }
  const config = readConfig();
  let threadId = config.leadThreadId;
  if (!threadId || conversationRepository.getThread(threadId)?.agentId !== agent.id) {
    threadId = conversationRepository.createThread(agent.id, "Telegram").id;
    writeConfig({ leadThreadId: threadId });
  }
  const run = createRunExecution({ agentId: agent.id, threadId, trigger: "chat", mode: "chat", prompt: text });
  recordMessage(chatId, message.message_id, "chat_request", run.id);
  void executeRunInBackground(run.id).catch((error) => console.error("[telegram] chat run failed", error));
}

async function handleCommand(chatId: string, message: TelegramMessage, command: string, argument: string) {
  switch (command) {
    case "/start":
    case "/help":
    case "/ayuda":
      await reply(chatId, HELP, message.message_id);
      return;
    case "/estado":
    case "/status":
      await reply(chatId, statusText(), message.message_id);
      return;
    case "/pausa":
    case "/pause":
      pauseAutonomy("telegram");
      await reply(chatId, "En pausa: no corre nada automático. /reanudar para volver.", message.message_id);
      return;
    case "/reanudar":
    case "/resume": {
      const policy = resumeAutonomy("telegram");
      await reply(chatId, `Reanudado en nivel ${policy.level} (${LEVEL_INFO[policy.level].name}).`, message.message_id);
      return;
    }
    case "/nivel":
    case "/level": {
      const level = Number(argument);
      if (!isAutonomyLevel(level)) {
        await reply(chatId, "Usá /nivel 0, 1, 2 o 3.", message.message_id);
        return;
      }
      const policy = updateAutonomyPolicy({ level }, "telegram");
      await reply(chatId, `Nivel ${policy.configuredLevel} (${LEVEL_INFO[policy.configuredLevel].name})${policy.paused ? ", sigue en pausa" : ""}.`, message.message_id);
      return;
    }
    case "/tarea":
    case "/task": {
      const agent = leadAgent();
      if (!agent || !argument) {
        await reply(chatId, agent ? "Escribí la tarea: /tarea <texto>" : "No hay un agente líder activo.", message.message_id);
        return;
      }
      try {
        const run = startAutonomyRun({
          agentId: agent.id,
          prompt: [`Task from the human (Telegram):`, "", argument].join("\n"),
          origin: "telegram",
          title: `Telegram: ${argument.slice(0, 80)}`,
          actor: "telegram",
        });
        await reply(chatId, `${agent.name} arrancó la tarea. ${link(`/runs/${run.id}`)}`, message.message_id);
      } catch (error) {
        await reply(chatId, `No pude arrancar la tarea: ${error instanceof Error ? error.message : String(error)}`, message.message_id);
      }
      return;
    }
    case "/preguntas":
    case "/questions": {
      const pending = listHumanRequests({ status: "pending" });
      await reply(
        chatId,
        pending.length
          ? pending.map((request) => `• ${request.question.slice(0, 200)}`).join("\n")
          : "No hay preguntas pendientes.",
        message.message_id,
      );
      return;
    }
    default:
      await reply(chatId, HELP, message.message_id);
  }
}

async function handleReply(chatId: string, message: TelegramMessage, text: string) {
  const reference = message.reply_to_message ? telegramRepository.messageRef(chatId, message.reply_to_message.message_id) : null;
  if (!reference?.refId) return false;
  try {
    if (reference.kind === "question") {
      const result = answerHumanRequest(reference.refId, text, "telegram");
      await reply(
        chatId,
        result.continuationRunId
          ? "Listo, sigue con tu respuesta."
          : `Respuesta guardada, pero el agente no pudo seguir: ${result.continuationError ?? "error desconocido"}. Usá /tarea para retomarlo.`,
        message.message_id,
      );
      return true;
    }
    if (reference.kind === "coding_stage") {
      // The reference is "<stage id>:<status>:<updated at>".
      const stage = codingRepository.getStage(reference.refId.split(":")[0]!);
      if (!stage) return false;
      const { replyToStage } = await import("@/lib/coding/service");
      await replyToStage(stage.codeRunId, stage.id, text);
      await reply(chatId, "Mensaje enviado a la etapa; vuelve a correr.", message.message_id);
      return true;
    }
    if (reference.kind === "approval") {
      await reply(chatId, "Usá los botones para aprobar o rechazar.", message.message_id);
      return true;
    }
  } catch (error) {
    await reply(chatId, `No pude hacerlo: ${error instanceof Error ? error.message : String(error)}`, message.message_id);
    return true;
  }
  return false;
}

async function handleMessage(message: TelegramMessage) {
  const chatId = String(message.chat.id);
  const text = message.text?.trim() ?? "";
  const config = readConfig();
  if (!config.chatId) {
    // Linking: only `/start <code>` from a private chat, with a valid one-time code.
    const match = /^\/start(?:@\w+)?\s+([A-Za-z0-9]{6,20})$/.exec(text);
    if (
      message.chat.type === "private" &&
      match &&
      config.linkCodeHash &&
      config.linkCodeExpiresAt &&
      config.linkCodeExpiresAt > now() &&
      hashCode(match[1]!) === config.linkCodeHash
    ) {
      const name = message.chat.username ? `@${message.chat.username}` : (message.chat.first_name ?? chatId);
      writeConfig({ chatId, chatName: name, linkedAt: now(), linkCodeHash: null, linkCodeExpiresAt: null });
      logAutonomyEvent({ kind: "telegram_linked", actor: "telegram", summary: `Telegram linked to ${name}.` });
      await reply(chatId, `Listo, este chat quedó vinculado a Slab.\n\n${HELP}`);
    }
    return;
  }
  // Only the linked chat can talk to Slab.
  if (chatId !== config.chatId || !text) return;
  if (text.startsWith("/")) {
    const [command = "", ...rest] = text.split(/\s+/);
    await handleCommand(chatId, message, command.replace(/@\w+$/, "").toLowerCase(), rest.join(" ").trim());
    return;
  }
  if (await handleReply(chatId, message, text)) return;
  await chatWithLead(chatId, message, text);
}

async function handleCallback(query: TelegramCallbackQuery) {
  const api = telegramApi();
  const config = readConfig();
  if (!api) return;
  const chatId = query.message ? String(query.message.chat.id) : "";
  if (!config.chatId || chatId !== config.chatId) {
    await api.answerCallbackQuery(query.id, "Este chat no está vinculado.").catch(() => undefined);
    return;
  }
  const [kind = "", id = "", value = ""] = (query.data ?? "").split(":");
  let outcome = "";
  try {
    if (kind === "ap") {
      await resolveApprovalAction(id, value === "y" ? "approve" : "deny");
      autonomyRepository.markApprovalResolved(id, value === "y" ? "approved_telegram" : "denied_telegram");
      outcome = value === "y" ? "✅ Aprobada" : "❌ Rechazada";
    } else if (kind === "q") {
      const request = getHumanRequest(id);
      const option = request?.options[Number(value)];
      if (!request || option === undefined) throw new Error("La pregunta ya no existe.");
      answerHumanRequest(id, option, "telegram");
      outcome = `✅ Respondida: ${option}`;
    } else if (kind === "pp") {
      const proposal = decideProposal(id, value === "y" ? "approve" : "reject", "telegram");
      outcome =
        proposal.status === "applied" ? "✅ Aplicada" : proposal.status === "rejected" ? "❌ Rechazada" : `⚠️ Falló: ${proposal.error ?? ""}`;
    } else if (kind === "cs") {
      const stage = codingRepository.getStage(id);
      if (!stage) throw new Error("La etapa ya no existe.");
      const { approveStage } = await import("@/lib/coding/service");
      approveStage(stage.codeRunId, stage.id);
      outcome = "✅ Aprobada";
    } else {
      throw new Error("Acción desconocida.");
    }
    await api.answerCallbackQuery(query.id, outcome).catch(() => undefined);
  } catch (error) {
    outcome = `⚠️ ${error instanceof Error ? error.message : String(error)}`;
    await api.answerCallbackQuery(query.id, outcome).catch(() => undefined);
  }
  if (query.message?.text) {
    await api
      .editMessageText({ chatId, messageId: query.message.message_id, text: `${query.message.text}\n\n→ ${outcome}` })
      .catch(() => undefined);
  }
}

export async function handleTelegramUpdate(update: TelegramUpdate) {
  if (update.message) await handleMessage(update.message);
  else if (update.callback_query) await handleCallback(update.callback_query);
}

// ---------------------------------------------------------------------------
// Outbox: everything Slab tells the operator

const urgencyMark = { low: "", normal: "", high: "🔴 " } as const;

async function sendOnce(kind: string, refId: string, build: () => { text: string; buttons?: InlineButton[][]; replyTo?: number | null } | null) {
  if (telegramRepository.wasSent(kind, refId)) return;
  const content = build();
  if (!content) return;
  try {
    await sendToOperator({ ...content, kind, refId });
  } catch (error) {
    // One failing message must not block the rest; it is retried on the next tick.
    console.error(`[telegram] could not send ${kind}`, error);
  }
}

export async function tickTelegramOutbox() {
  const config = readConfig();
  if (!config.chatId || !config.tokenCiphertext) return;
  const since = config.linkedAt ?? now();

  // Approvals waiting for the human.
  for (const approval of telegramRepository.pendingApprovals(since)) {
    await sendOnce("approval", approval.id, () => ({
      text: `🔐 ${approval.agentName} pide aprobación:\n${approval.command.slice(0, 2_500)}\n\n${link(`/runs/${approval.runId}`)}`,
      buttons: [[
        { text: "✅ Aprobar", callback_data: `ap:${approval.id}:y` },
        { text: "❌ Rechazar", callback_data: `ap:${approval.id}:n` },
      ]],
    }));
  }

  // Questions and updates from agents.
  for (const request of [...listHumanRequests({ status: "pending", limit: 20 }), ...listHumanRequests({ status: "sent", limit: 20 })]) {
    if (request.createdAt < since) continue;
    const agent = request.agentId ? agentRepository.getAgent(request.agentId) : null;
    await sendOnce(request.kind === "question" ? "question" : "update", request.id, () => {
      if (request.kind === "update") return { text: `${urgencyMark[request.urgency]}ℹ️ ${agent?.name ?? "Slab"}: ${request.question}` };
      const fallback = request.defaultAnswer
        ? `Si no respondés antes de ${request.expiresAt}, sigue con: "${request.defaultAnswer}".`
        : `Si no respondés antes de ${request.expiresAt}, sigue sin respuesta.`;
      return {
        text: `${urgencyMark[request.urgency]}❓ ${agent?.name ?? "Un agente"} pregunta:\n${request.question}\n\nRespondé a este mensaje${request.options.length ? " o elegí una opción" : ""}. ${fallback}`,
        buttons: request.options.length
          ? request.options.map((option, index) => [{ text: option, callback_data: `q:${request.id}:${index}` }])
          : undefined,
      };
    });
  }

  // Changes proposed by agents (self-management in draft mode).
  for (const proposal of listProposals({ status: "pending", limit: 20 })) {
    if (proposal.createdAt < since) continue;
    const agent = proposal.agentId ? agentRepository.getAgent(proposal.agentId) : null;
    await sendOnce("proposal", proposal.id, () => ({
      text: `🛠 ${agent?.name ?? "Un agente"} propone: ${proposal.summary}\n\n${JSON.stringify(proposal.payload, null, 2).slice(0, 2_500)}`,
      buttons: [[
        { text: "✅ Aplicar", callback_data: `pp:${proposal.id}:y` },
        { text: "❌ Rechazar", callback_data: `pp:${proposal.id}:n` },
      ]],
    }));
  }

  // Coding runs: stages that wait for the human. The reference is "<stage>:<status>:<updated at>".
  for (const row of telegramRepository.codingStagesWaiting(since)) {
    const stage = row.stage as keyof typeof STAGE_DEFINITIONS;
    const name = STAGE_DEFINITIONS[stage]?.name ?? row.stage;
    const waiting = row.status === "waiting_approval";
    const canApprove = waiting && stage !== "pr_feedback";
    await sendOnce("coding_stage", `${row.id}:${row.status}:${row.updatedAt}`, () => ({
      text: [
        `🧩 Coding #${row.number} · ${row.issueKey} · ${name} ${waiting ? "espera tu aprobación" : "necesita tu respuesta"}`,
        row.summary.slice(0, 1_500),
        ...(row.questions.length ? ["", ...row.questions.map((question) => `• ${question}`)] : []),
        "",
        canApprove ? "Aprobá con el botón, o respondé a este mensaje para pedir cambios." : "Respondé a este mensaje.",
        link(`/coding/${row.number}`),
      ].join("\n"),
      buttons: canApprove
        ? [[{ text: stage === "code_review" ? "✅ Publicar PR" : "✅ Aprobar", callback_data: `cs:${row.id}:ok` }]]
        : undefined,
    }));
  }

  // Pull requests ready for review (and builds).
  for (const pull of telegramRepository.pullRequestsOpened(since)) {
    await sendOnce("pull_request", pull.id, () => ({
      text: `🚀 PR listo para revisar: ${pull.repository}#${pull.number}\n${pull.issueKey} — ${pull.title}\n${pull.url}\n\nRevisalo y hacé los builds.`,
    }));
  }

  // Failures and blocked work.
  for (const failed of telegramRepository.failedRuns(since)) {
    await sendOnce("run_failed", failed.id, () => ({
      text: `⚠️ Falló un run de ${failed.agentName}: ${(failed.error ?? "sin detalle").slice(0, 800)}\n${link(`/runs/${failed.id}`)}`,
    }));
  }
  for (const blocked of telegramRepository.blockedWork(since)) {
    await sendOnce("work_blocked", `${blocked.issueKey}:${blocked.token}`, () => ({
      text: `⛔ ${blocked.issueKey} quedó bloqueado y necesita atención.\n${link("/work")}`,
    }));
  }

  // Answers of the lead agent to free messages.
  for (const chat of telegramRepository.listUnansweredChats(config.chatId)) {
    const run = runRepository.getRun(chat.runId);
    if (!run || !TERMINAL.has(run.status)) continue;
    const output = conversationRepository.getRunAssistantOutput(chat.runId)?.body?.trim();
    await sendOnce("chat_reply", chat.runId, () => ({
      text: run.status === "completed" ? output || "(sin respuesta)" : `⚠️ No pude responder: ${run.error ?? run.status}`,
      replyTo: chat.messageId,
    }));
  }
}

/** Reminders for approvals that wait too long (approval timeout "escalate" or "deny"). */
export async function remindApproval(approvalId: string, minutes: number) {
  const approval = approvalRepository.get(approvalId);
  if (!approval) return;
  await sendToOperator({
    kind: "approval_reminder",
    refId: approvalId,
    text: `⏰ Hace ${minutes} min que espera una aprobación:\n${approval.command.slice(0, 1_500)}\n${link(`/runs/${approval.runId}`)}`,
    buttons: [[
      { text: "✅ Aprobar", callback_data: `ap:${approval.id}:y` },
      { text: "❌ Rechazar", callback_data: `ap:${approval.id}:n` },
    ]],
  });
}

// ---------------------------------------------------------------------------
// Polling loop

const loopState = globalThis as unknown as {
  slabTelegramLoop?: boolean;
  slabTelegramOutbox?: NodeJS.Timeout;
  slabTelegramOutboxBusy?: boolean;
};

async function pollOnce() {
  const api = telegramApi();
  if (!api) return false;
  const config = readConfig();
  try {
    const updates = await api.getUpdates(config.offset ?? 0, 25);
    for (const update of updates) {
      try {
        await handleTelegramUpdate(update);
      } catch (error) {
        console.error("[telegram] update failed", error);
      }
      writeConfig({ offset: update.update_id + 1 });
    }
    writeConfig({ lastPollAt: now(), lastError: null });
    return true;
  } catch (error) {
    writeConfig({ lastError: error instanceof Error ? error.message : String(error), lastPollAt: now() });
    return false;
  }
}

export function startTelegram() {
  if (!loopState.slabTelegramOutbox) {
    loopState.slabTelegramOutbox = setInterval(() => {
      if (loopState.slabTelegramOutboxBusy) return;
      loopState.slabTelegramOutboxBusy = true;
      void tickTelegramOutbox()
        .catch((error) => console.error("[telegram] outbox failed", error))
        .finally(() => {
          loopState.slabTelegramOutboxBusy = false;
        });
    }, 3_000);
    loopState.slabTelegramOutbox.unref?.();
  }
  if (loopState.slabTelegramLoop) return;
  loopState.slabTelegramLoop = true;
  void (async () => {
    for (;;) {
      const ok = await pollOnce().catch(() => false);
      if (!ok) await new Promise((resolve) => setTimeout(resolve, readConfig().tokenCiphertext ? 5_000 : 15_000));
    }
  })();
}
