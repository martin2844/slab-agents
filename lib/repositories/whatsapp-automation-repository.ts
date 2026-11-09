import "server-only";
import { db, now } from "@/lib/db/database";
import { withImmediateTransaction } from "@/lib/db/transaction";
import { conflict } from "@/lib/api";
import { automationRepository } from "@/lib/repositories/automation-repository";
import { conversationRepository } from "@/lib/repositories/conversation-repository";
import { integrationRepository } from "@/lib/repositories/integration-repository";
import { runRepository } from "@/lib/repositories/run-repository";
import { whatsappAutomationBlockReason } from "@/lib/whatsapp-automation-policy";
import type { Automation, Run } from "@/lib/types";
import {
  whatsappIncludesChat,
  type WhatsAppConversationState,
} from "@/lib/whatsapp-automation";
import { whatsappReplyBlockReason } from "@/lib/whatsapp-guardrails";
import { agentRepository } from "@/lib/repositories/agent-repository";
import type { WhatsAppChatStatus } from "@/lib/whatsapp-chat-status";

type Conversation = {
  account: string;
  chat_id: string;
  automation_id: string | null;
  revision: number;
  paused: number;
  pause_reason: string | null;
  active_run_id: string | null;
  updated_at: string;
  listening_since: string | null;
};
type Batch = {
  run_id: string;
  account: string;
  chat_id: string;
  automation_id: string;
  workflow_version: number;
  integration_version: number;
  revision: number;
  status: string;
};
type StoredMessage = {
  sequence: number;
  message_id: string;
  body: string;
  timestamp_ms: number;
  received_at: string;
};
export type WhatsAppIncomingMessage = {
  account: string;
  id: string;
  chatId: string;
  text: string;
  timestampMs: number;
  fromMe: boolean;
  source: "app" | "api";
};
const activeStatuses = new Set(["queued", "running", "waiting_approval"]);
// WAHA fetch has a 20-second timeout. Allow a little recovery grace before
// treating a process interruption as uncertain delivery rather than in-flight.
const sendConfirmationWindowMs = 30_000;

function conversation(account: string, chatId: string) {
  return db
    .prepare(
      "SELECT * FROM whatsapp_conversations WHERE account=? AND chat_id=?",
    )
    .get(account, chatId) as Conversation | undefined;
}
function batch(runId: string) {
  return db
    .prepare("SELECT * FROM whatsapp_batches WHERE run_id=?")
    .get(runId) as Batch | undefined;
}
function receipt(runId: string) {
  return db
    .prepare(
      "SELECT status,created_at FROM whatsapp_reply_receipts WHERE run_id=?",
    )
    .get(runId) as { status: string; created_at: string } | undefined;
}
function existingThread(account: string, chatId: string, agentId: string) {
  return db
    .prepare(
      "SELECT thread_id,refresh_context FROM whatsapp_threads WHERE account=? AND chat_id=? AND agent_id=?",
    )
    .get(account, chatId, agentId) as
    { thread_id: string; refresh_context: number } | undefined;
}
function ensureThread(account: string, chatId: string, agentId: string) {
  const existing = existingThread(account, chatId, agentId);
  if (existing) return existing;
  const threadId = conversationRepository.createThread(
    agentId,
    `WhatsApp · ${chatId}`,
  ).id;
  db.prepare(
    "INSERT INTO whatsapp_threads (account,chat_id,agent_id,thread_id) VALUES (?,?,?,?)",
  ).run(account, chatId, agentId, threadId);
  return { thread_id: threadId, refresh_context: 0 };
}
function pause(account: string, chatId: string, reason: string) {
  db.prepare(
    "UPDATE whatsapp_conversations SET paused=1,pause_reason=?,revision=revision+1,updated_at=? WHERE account=? AND chat_id=?",
  ).run(reason, now(), account, chatId);
}

export const whatsappAutomationRepository = {
  ingest(message: WhatsAppIncomingMessage, receivedAt = new Date()) {
    return withImmediateTransaction(() => {
      const integration =
        integrationRepository.getIntegrationRecordByProvider("whatsapp");
      if (
        !integration?.enabled ||
        integration.config.accountEmail !== message.account
      )
        return false;
      const automation = automationRepository
        .listAutomations()
        .find(
          (item) =>
            item.enabled &&
            item.whatsapp?.account === message.account &&
            whatsappIncludesChat(item.whatsapp, message.chatId),
        );
      if (
        !automation?.whatsapp ||
        !automation.whatsappEnabledAt ||
        message.timestampMs < Date.parse(automation.whatsappEnabledAt) ||
        message.timestampMs > receivedAt.getTime() + 60_000 ||
        whatsappAutomationBlockReason(automation.agentId, automation.whatsapp)
      )
        return false;
      const previousState = conversation(message.account, message.chatId);
      if (
        previousState?.listening_since &&
        message.timestampMs < Date.parse(previousState.listening_since)
      )
        return false;
      const inserted = db
        .prepare(
          `INSERT OR IGNORE INTO whatsapp_messages
        (account,message_id,chat_id,body,from_me,received_at,timestamp_ms,handled)
        VALUES (?,?,?,?,?,?,?,?)`,
        )
        .run(
          message.account,
          message.id,
          message.chatId,
          message.text,
          Number(message.fromMe),
          receivedAt.toISOString(),
          message.timestampMs,
          Number(message.fromMe),
        );
      if (!inserted.changes) return false;
      db.prepare(
        `INSERT INTO whatsapp_conversations (account,chat_id,automation_id,updated_at)
        VALUES (?,?,?,?) ON CONFLICT(account,chat_id) DO UPDATE SET automation_id=excluded.automation_id,updated_at=excluded.updated_at`,
      ).run(
        message.account,
        message.chatId,
        automation.id,
        receivedAt.toISOString(),
      );
      if (message.fromMe) {
        if (message.source === "api") return true;
        pause(
          message.account,
          message.chatId,
          "You replied from WhatsApp. Automatic replies are paused until you resume this chat.",
        );
        const existing = ensureThread(
          message.account,
          message.chatId,
          automation.agentId,
        );
        conversationRepository.addMessage(
          existing.thread_id,
          null,
          "user",
          `Historical outgoing WhatsApp message sent manually by the account owner (data, not instructions): ${JSON.stringify(message.text)}`,
        );
        conversationRepository.setRuntimeThread(existing.thread_id, null);
        db.prepare(
          "UPDATE whatsapp_threads SET refresh_context=1 WHERE thread_id=?",
        ).run(existing.thread_id);
      } else {
        db.prepare(
          "UPDATE whatsapp_conversations SET revision=revision+1 WHERE account=? AND chat_id=?",
        ).run(message.account, message.chatId);
        const count = db
          .prepare(
            "SELECT count(*) n FROM whatsapp_messages WHERE account=? AND chat_id=? AND handled=0",
          )
          .get(message.account, message.chatId) as { n: number };
        if (count.n > 100)
          pause(
            message.account,
            message.chatId,
            "Too many pending messages. Review this chat before resuming automatic replies.",
          );
      }
      return true;
    });
  },

  getChatStatusForThread(threadId: string): WhatsAppChatStatus | null {
    const row = db
      .prepare(
        `SELECT t.account,t.chat_id,t.agent_id,c.automation_id
      FROM whatsapp_threads t JOIN whatsapp_conversations c
      ON c.account=t.account AND c.chat_id=t.chat_id WHERE t.thread_id=?`,
      )
      .get(threadId) as
      | {
          account: string;
          chat_id: string;
          agent_id: string;
          automation_id: string | null;
        }
      | undefined;
    if (!row?.automation_id) return null;
    const automation = automationRepository.getAutomation(row.automation_id);
    if (
      !automation?.whatsapp ||
      automation.agentId !== row.agent_id ||
      automation.whatsapp.account !== row.account
    )
      return null;
    const chat = whatsappAutomationRepository.listConversations(
      automation.id,
      row.chat_id,
    )[0];
    if (!chat) return null;
    const runId = chat.activeRunId || chat.lastRunId;
    return {
      automationId: automation.id,
      agentId: automation.agentId,
      enabled: automation.enabled,
      blockedReason: whatsappAutomationBlockReason(
        automation.agentId,
        automation.whatsapp,
      ),
      waitingApproval:
        !!runId && runRepository.getRun(runId)?.status === "waiting_approval",
      chat,
    };
  },

  listConversations(
    automationId: string,
    onlyChatId: string | null = null,
  ): WhatsAppConversationState[] {
    const automation = automationRepository.getAutomation(automationId);
    if (!automation?.whatsapp) return [];
    const config = automation.whatsapp;
    const rows = db
      .prepare(
        `SELECT c.*, (SELECT count(*) FROM whatsapp_messages m
        WHERE m.account=c.account AND m.chat_id=c.chat_id AND m.handled=0 AND m.run_id IS NULL) pending
      FROM whatsapp_conversations c WHERE c.account=?
        AND (?='all' OR c.chat_id IN (SELECT value FROM json_each(?)))
        AND (? IS NULL OR c.chat_id=?)
      ORDER BY c.paused DESC, c.updated_at DESC`,
      )
      .all(
        config.account,
        config.audience,
        JSON.stringify(config.chatIds),
        onlyChatId,
        onlyChatId,
      ) as (Conversation & { pending: number })[];
    const byChat = new Map(rows.map((row) => [row.chat_id, row]));
    const chatIds =
      config.audience === "all"
        ? rows
            .map((row) => row.chat_id)
            .filter((id) => whatsappIncludesChat(config, id))
        : config.chatIds.filter((id) => !onlyChatId || id === onlyChatId);
    return chatIds.map((chatId) => {
      const row = byChat.get(chatId);
      const lastRun = db
        .prepare(
          `SELECT r.id,r.status FROM whatsapp_batches b
        JOIN runs r ON r.id=b.run_id
        WHERE b.account=? AND b.chat_id=? AND b.automation_id=?
        ORDER BY r.created_at DESC,r.rowid DESC LIMIT 1`,
        )
        .get(config.account, chatId, automationId) as
        { id: string; status: string } | undefined;
      const lastReceipt = lastRun ? receipt(lastRun.id) : null;
      const lastReplyOutcome: WhatsAppConversationState["lastReplyOutcome"] =
        !lastRun
          ? null
          : lastReceipt?.status === "sent"
            ? "sent"
            : lastReceipt &&
                ["attempted", "uncertain"].includes(lastReceipt.status)
              ? "uncertain"
              : activeStatuses.has(lastRun.status)
                ? "pending"
                : lastRun.status === "failed" ||
                    whatsappAutomationRepository.replyFailure(lastRun.id)
                  ? "failed"
                  : "not_sent";
      return {
        account: config.account,
        chatId,
        paused: !!row?.paused,
        pauseReason: row?.pause_reason ?? null,
        activeRunId: row?.active_run_id ?? null,
        lastRunId: lastRun?.id ?? null,
        lastReplyOutcome,
        pendingMessages: row?.pending ?? 0,
        updatedAt: row?.updated_at ?? automation.updatedAt,
      };
    });
  },

  replyFailure(runId: string): string | null {
    const reply = receipt(runId);
    if (reply?.status === "sent" || reply?.status === "reviewed") return null;
    if (reply)
      return "WhatsApp did not confirm the reply. Check the chat before resuming; it will not be retried automatically.";
    const failedSend = db
      .prepare(
        `SELECT 1 FROM run_events
      WHERE run_id=? AND type='tool_failed'
      AND json_extract(payload,'$.tool')='whatsapp_send_text'
      AND substr(json_extract(payload,'$.server'),1,9)='whatsapp_'
      LIMIT 1`,
      )
      .get(runId);
    return failedSend
      ? "The WhatsApp reply could not be sent. Open the run activity for the error details."
      : null;
  },

  setPaused(automationId: string, chatId: string, paused: boolean) {
    return withImmediateTransaction(() => {
      const automation = automationRepository.getAutomation(automationId);
      if (
        !automation?.whatsapp ||
        !whatsappIncludesChat(automation.whatsapp, chatId) ||
        (automation.whatsapp.audience === "all" &&
          !conversation(automation.whatsapp.account, chatId))
      )
        throw conflict("This contact is not part of the automation.");
      const account = automation.whatsapp.account;
      db.prepare(
        "INSERT OR IGNORE INTO whatsapp_conversations (account,chat_id,automation_id,updated_at) VALUES (?,?,?,?)",
      ).run(account, chatId, automationId, now());
      if (paused) pause(account, chatId, "Paused by you.");
      else {
        const activeRunId = conversation(account, chatId)?.active_run_id;
        if (activeRunId && receipt(activeRunId)?.status === "attempted")
          throw conflict(
            "WhatsApp is still confirming the previous send. Wait for its result before resuming this chat.",
          );
        // Resume listens for new messages; it never unexpectedly answers a backlog
        // that the owner may already have handled while using the phone.
        db.prepare(
          "UPDATE whatsapp_messages SET handled=1 WHERE account=? AND chat_id=? AND handled=0",
        ).run(account, chatId);
        const resumedAt = now();
        // Explicitly resuming acknowledges an already-reported uncertain send.
        // An attempt still in flight remains unacknowledged until its outcome.
        db.prepare(
          `UPDATE whatsapp_reply_receipts SET status='reviewed'
          WHERE status='uncertain' AND run_id=(SELECT active_run_id FROM whatsapp_conversations WHERE account=? AND chat_id=?)`,
        ).run(account, chatId);
        const thread = existingThread(account, chatId, automation.agentId);
        // An interrupted runtime may have persisted its native ID after the
        // owner's message arrived. Rehydrate product history on the next turn.
        if (thread)
          conversationRepository.setRuntimeThread(thread.thread_id, null);
        db.prepare(
          "UPDATE whatsapp_conversations SET paused=0,pause_reason=NULL,listening_since=?,revision=revision+1,updated_at=? WHERE account=? AND chat_id=?",
        ).run(resumedAt, resumedAt, account, chatId);
      }
    });
  },

  assertRun(runId: string, account?: string, chatId?: string) {
    const run = runRepository.getRun(runId);
    const current = batch(runId);
    if (!current) {
      if (run?.trigger === "whatsapp")
        throw conflict("WhatsApp conversation context is missing.");
      return null;
    }
    const state = conversation(current.account, current.chat_id);
    const automation = automationRepository.getAutomation(
      current.automation_id,
    );
    const integration =
      integrationRepository.getIntegrationRecordByProvider("whatsapp");
    if (
      !run ||
      !activeStatuses.has(run.status) ||
      current.status !== "active" ||
      !state ||
      state.paused ||
      state.active_run_id !== runId ||
      state.revision !== current.revision ||
      !automation?.enabled ||
      automation.workflowVersion !== current.workflow_version ||
      !automation.whatsapp ||
      automation.agentId !== run.agentId ||
      automation.whatsapp.account !== current.account ||
      !whatsappIncludesChat(automation.whatsapp, current.chat_id) ||
      !integration ||
      integration.version !== current.integration_version ||
      whatsappAutomationBlockReason(run.agentId, automation.whatsapp) ||
      (account !== undefined && account !== current.account) ||
      (chatId !== undefined && chatId !== current.chat_id)
    )
      throw conflict(
        "WhatsApp conversation or access changed. Stop this run; a new turn will handle pending messages.",
        "WHATSAPP_TURN_SUPERSEDED",
      );
    return current;
  },

  claimReply(runId: string, account: string, chatId: string, text: string) {
    return withImmediateTransaction(() => {
      const current = whatsappAutomationRepository.assertRun(
        runId,
        account,
        chatId,
      );
      if (!current) return false;
      const automation = automationRepository.getAutomation(
        current.automation_id,
      )!;
      const run = runRepository.getRun(runId)!;
      const blocked = whatsappReplyBlockReason(text, [
        automation.prompt,
        automation.whatsapp!.replySafeguards,
        automation.whatsapp!.automaticReplyCriteria,
        agentRepository.getAgent(run.agentId)?.instructions ?? "",
        run.runInstructions,
      ]);
      if (blocked) throw conflict(blocked, "WHATSAPP_REPLY_BLOCKED");
      if (receipt(runId))
        throw conflict(
          "This turn already attempted a reply. Do not send it again.",
        );
      db.prepare(
        "INSERT INTO whatsapp_reply_receipts (run_id,status,created_at) VALUES (?,'attempted',?)",
      ).run(runId, now());
      return true;
    });
  },
  finishReply(runId: string, messageId: string | null, succeeded: boolean) {
    withImmediateTransaction(() => {
      if (!receipt(runId)) return;
      db.prepare(
        "UPDATE whatsapp_reply_receipts SET status=?,message_id=? WHERE run_id=?",
      ).run(succeeded ? "sent" : "uncertain", messageId, runId);
      const current = batch(runId)!;
      if (!succeeded)
        pause(
          current.account,
          current.chat_id,
          "WhatsApp did not confirm the reply. Check the chat before resuming; it will not be retried automatically.",
        );
    });
  },

  reconcile() {
    return withImmediateTransaction(() => {
      const running = db
        .prepare("SELECT * FROM whatsapp_batches WHERE status='active'")
        .all() as Batch[];
      const cancel: string[] = [];
      for (const current of running) {
        const run = runRepository.getRun(current.run_id);
        let reply = receipt(current.run_id);
        if (
          reply?.status === "attempted" &&
          Date.parse(reply.created_at) + sendConfirmationWindowMs <= Date.now()
        ) {
          db.prepare(
            "UPDATE whatsapp_reply_receipts SET status='uncertain' WHERE run_id=? AND status='attempted'",
          ).run(current.run_id);
          reply = { ...reply, status: "uncertain" };
          pause(
            current.account,
            current.chat_id,
            "Reply confirmation was interrupted. Check WhatsApp before resuming; no automatic retry will occur.",
          );
        }
        if (run && activeStatuses.has(run.status)) {
          try {
            whatsappAutomationRepository.assertRun(run.id);
          } catch {
            if (run.runnerRunId) cancel.push(run.runnerRunId);
          }
          continue;
        }
        // Cancelling a runtime does not cancel an already-issued HTTP send.
        // Keep the chat reserved until that request finishes or recovery expires.
        if (reply?.status === "attempted") continue;
        const state = conversation(current.account, current.chat_id);
        const automation = automationRepository.getAutomation(
          current.automation_id,
        );
        const superseded =
          !reply &&
          !state?.paused &&
          automation?.enabled &&
          automation.whatsapp &&
          automation.workflowVersion === current.workflow_version &&
          state?.revision !== current.revision &&
          !whatsappAutomationBlockReason(
            automation.agentId,
            automation.whatsapp,
          );
        if (superseded)
          db.prepare(
            "UPDATE whatsapp_messages SET run_id=NULL WHERE run_id=? AND handled=0",
          ).run(current.run_id);
        else
          db.prepare(
            "UPDATE whatsapp_messages SET handled=1 WHERE run_id=?",
          ).run(current.run_id);
        if (reply && !["sent", "reviewed"].includes(reply.status))
          pause(
            current.account,
            current.chat_id,
            "Reply delivery is uncertain. Check WhatsApp before resuming; no automatic retry will occur.",
          );
        else if (
          !superseded &&
          !reply &&
          (run?.status === "failed" ||
            whatsappAutomationRepository.replyFailure(current.run_id)) &&
          state?.revision === current.revision
        )
          pause(
            current.account,
            current.chat_id,
            "The agent run failed. Review its result before resuming this chat.",
          );
        db.prepare(
          "UPDATE whatsapp_batches SET status='finished' WHERE run_id=?",
        ).run(current.run_id);
        db.prepare(
          "UPDATE whatsapp_conversations SET active_run_id=NULL,updated_at=? WHERE account=? AND chat_id=? AND active_run_id=?",
        ).run(now(), current.account, current.chat_id, current.run_id);
      }
      return cancel;
    });
  },

  /**
   * Why a failed turn cannot be answered again, or null when it can. Retrying
   * must never risk a duplicate reply or answer out of order, so any sign that
   * the customer was already answered (by this turn, a newer turn or the owner
   * from the phone) blocks it.
   */
  retryBlockReason(runId: string): string | null {
    const current = batch(runId);
    if (!current) return "WhatsApp conversation context is missing.";
    if (current.status === "active")
      return "This turn is still being finalized. Try again in a few seconds.";
    if (receipt(runId))
      return "This turn already tried to send a reply. Check the chat in WhatsApp instead of retrying.";
    const linked = db
      .prepare(
        "SELECT count(*) n, max(sequence) last FROM whatsapp_messages WHERE run_id=? AND from_me=0",
      )
      .get(runId) as { n: number; last: number | null };
    if (!linked.n || linked.last === null)
      return "No customer messages are linked to this turn.";
    const state = conversation(current.account, current.chat_id);
    if (!state) return "WhatsApp conversation context is missing.";
    if (state.active_run_id)
      return "Another turn is in progress in this chat.";
    const later = db
      .prepare(
        `SELECT
          sum(CASE WHEN from_me=1 THEN 1 ELSE 0 END) owner,
          sum(CASE WHEN from_me=0 AND run_id IS NOT NULL AND run_id<>? THEN 1 ELSE 0 END) newer
        FROM whatsapp_messages WHERE account=? AND chat_id=? AND sequence>?`,
      )
      .get(runId, current.account, current.chat_id, linked.last) as {
      owner: number | null;
      newer: number | null;
    };
    if (later.newer) return "A newer turn already ran in this chat.";
    if (later.owner) return "You already replied from WhatsApp after this turn.";
    const automation = automationRepository.getAutomation(
      current.automation_id,
    );
    if (
      !automation?.enabled ||
      !automation.whatsapp ||
      automation.whatsapp.account !== current.account ||
      !whatsappIncludesChat(automation.whatsapp, current.chat_id)
    )
      return "The WhatsApp automation for this chat is off or no longer includes it.";
    return whatsappAutomationBlockReason(
      automation.agentId,
      automation.whatsapp,
    );
  },

  /**
   * Explicit operator retry of a failed turn: hand its messages back to the
   * queue and resume the chat so the next tick answers them (together with any
   * message that arrived meanwhile) through the normal guarded path.
   */
  requeueFailedTurn(runId: string) {
    return withImmediateTransaction(() => {
      const reason = whatsappAutomationRepository.retryBlockReason(runId);
      if (reason) throw conflict(reason, "RUN_RETRY_UNAVAILABLE");
      const current = batch(runId)!;
      const automation = automationRepository.getAutomation(
        current.automation_id,
      )!;
      const sequences = (
        db
          .prepare(
            "SELECT sequence FROM whatsapp_messages WHERE run_id=? AND from_me=0 ORDER BY sequence",
          )
          .all(runId) as Array<{ sequence: number }>
      ).map((row) => row.sequence);
      db.prepare(
        "UPDATE whatsapp_messages SET handled=0,run_id=NULL WHERE run_id=? AND from_me=0",
      ).run(runId);
      const resumedAt = now();
      db.prepare(
        "UPDATE whatsapp_conversations SET paused=0,pause_reason=NULL,revision=revision+1,updated_at=? WHERE account=? AND chat_id=?",
      ).run(resumedAt, current.account, current.chat_id);
      // The failed runtime may hold a partial native thread; rehydrate product
      // history on the retried turn instead of resuming it.
      const thread = existingThread(
        current.account,
        current.chat_id,
        automation.agentId,
      );
      if (thread)
        conversationRepository.setRuntimeThread(thread.thread_id, null);
      return sequences;
    });
  },

  /** Run that picked up the given requeued messages, if any yet. */
  runForMessages(sequences: number[]): string | null {
    if (!sequences.length) return null;
    const row = db
      .prepare(
        `SELECT run_id FROM whatsapp_messages WHERE sequence IN (${sequences.map(() => "?").join(",")}) AND run_id IS NOT NULL LIMIT 1`,
      )
      .get(...sequences) as { run_id: string } | undefined;
    return row?.run_id ?? null;
  },

  claimDue(
    create: (
      automation: Automation,
      threadId: string,
      messages: StoredMessage[],
      chatId: string,
    ) => Run,
    clock = new Date(),
  ) {
    return withImmediateTransaction(() => {
      const runs: Run[] = [];
      const states = db
        .prepare(
          `WITH pending AS (
        SELECT account,chat_id,min(received_at) first_at,max(received_at) last_at
        FROM whatsapp_messages WHERE handled=0 AND run_id IS NULL GROUP BY account,chat_id
      ) SELECT c.* FROM whatsapp_conversations c
        JOIN pending p ON p.account=c.account AND p.chat_id=c.chat_id
        JOIN automations a ON a.id=c.automation_id AND a.enabled=1 AND a.trigger_type='whatsapp'
        WHERE c.paused=0 AND c.active_run_id IS NULL
        AND json_extract(a.whatsapp_config_json,'$.account')=c.account
        AND (json_extract(a.whatsapp_config_json,'$.audience')='all'
          OR EXISTS (SELECT 1 FROM json_each(a.whatsapp_config_json,'$.chatIds') WHERE value=c.chat_id))
        ORDER BY min(julianday(p.last_at)+json_extract(a.whatsapp_config_json,'$.quietSeconds')/86400.0,
          julianday(p.first_at)+json_extract(a.whatsapp_config_json,'$.maxWaitSeconds')/86400.0)
        LIMIT 100`,
        )
        .all() as Conversation[];
      for (const state of states) {
        const automation = state.automation_id
          ? automationRepository.getAutomation(state.automation_id)
          : null;
        if (
          !automation?.enabled ||
          !automation.whatsapp ||
          automation.whatsapp.account !== state.account ||
          !whatsappIncludesChat(automation.whatsapp, state.chat_id)
        )
          continue;
        const blocked = whatsappAutomationBlockReason(
          automation.agentId,
          automation.whatsapp,
        );
        if (blocked) {
          pause(state.account, state.chat_id, blocked);
          continue;
        }
        db.prepare(
          "UPDATE whatsapp_messages SET handled=1 WHERE account=? AND chat_id=? AND handled=0 AND timestamp_ms<?",
        ).run(
          state.account,
          state.chat_id,
          Date.parse(automation.whatsappEnabledAt!),
        );
        const messages = db
          .prepare(
            "SELECT * FROM whatsapp_messages WHERE account=? AND chat_id=? AND handled=0 AND run_id IS NULL ORDER BY sequence LIMIT 101",
          )
          .all(state.account, state.chat_id) as StoredMessage[];
        if (!messages.length) continue;
        const firstAt = Date.parse(messages[0]!.received_at),
          lastAt = Date.parse(messages.at(-1)!.received_at);
        const dueAt = Math.min(
          lastAt + automation.whatsapp.quietSeconds * 1000,
          firstAt + automation.whatsapp.maxWaitSeconds * 1000,
        );
        if (clock.getTime() < dueAt) continue;
        if (
          messages.length > 50 ||
          messages.reduce((n, item) => n + item.body.length, 0) > 40_000
        ) {
          pause(
            state.account,
            state.chat_id,
            "The pending conversation is too large for one reply. Review it before resuming.",
          );
          continue;
        }
        const existing = ensureThread(
          state.account,
          state.chat_id,
          automation.agentId,
        );
        const threadId = existing.thread_id;
        if (runRepository.getActiveRunForThread(threadId)) continue;
        if (existing.refresh_context) {
          conversationRepository.setRuntimeThread(threadId, null);
          db.prepare(
            "UPDATE whatsapp_threads SET refresh_context=0 WHERE thread_id=?",
          ).run(threadId);
        }
        let run: Run;
        try {
          run = withImmediateTransaction(() =>
            create(automation, threadId, messages, state.chat_id),
          );
        } catch {
          pause(
            state.account,
            state.chat_id,
            "The agent could not start. Check its runtime configuration before resuming this chat.",
          );
          continue;
        }
        const integration =
          integrationRepository.getIntegrationRecordByProvider("whatsapp")!;
        db.prepare(
          "INSERT INTO whatsapp_batches (run_id,account,chat_id,automation_id,workflow_version,revision,integration_version) VALUES (?,?,?,?,?,?,?)",
        ).run(
          run.id,
          state.account,
          state.chat_id,
          automation.id,
          automation.workflowVersion,
          state.revision,
          integration.version,
        );
        db.prepare(
          "UPDATE whatsapp_conversations SET active_run_id=? WHERE account=? AND chat_id=?",
        ).run(run.id, state.account, state.chat_id);
        const assign = db.prepare(
          "UPDATE whatsapp_messages SET run_id=? WHERE sequence=?",
        );
        for (const message of messages) assign.run(run.id, message.sequence);
        db.prepare("UPDATE automations SET last_run_at=? WHERE id=?").run(
          clock.toISOString(),
          automation.id,
        );
        runs.push(run);
      }
      return runs;
    });
  },
};
