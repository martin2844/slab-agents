import "server-only";

import { randomUUID } from "node:crypto";
import { db, now } from "@/lib/db/database";
import type { Row } from "@/lib/repositories/repository-helpers";
import type { Message, Thread } from "@/lib/types";

function mapThread(row: Row): Thread {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    title: String(row.title),
    runtimeThreadId: row.runtime_thread_id
      ? String(row.runtime_thread_id)
      : null,
    runtime: row.runtime ? String(row.runtime) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapMessage(row: Row): Message {
  return {
    id: String(row.id),
    threadId: String(row.thread_id),
    runId: row.run_id ? String(row.run_id) : null,
    role: row.role as Message["role"],
    body: String(row.body),
    createdAt: String(row.created_at),
  };
}

export const conversationRepository = {
  getWorkAgentThread(issueKey: string, agentId: string) {
    const row = db
      .prepare(
        `SELECT t.* FROM work_agent_threads w
         JOIN threads t ON t.id=w.thread_id
         WHERE w.issue_key=? AND w.agent_id=?`,
      )
      .get(issueKey, agentId) as Row | undefined;
    return row ? mapThread(row) : null;
  },
  getOrCreateWorkAgentThread(issueKey: string, agentId: string, title: string) {
    const existing = conversationRepository.getWorkAgentThread(
      issueKey,
      agentId,
    );
    if (existing) return existing;
    const thread = conversationRepository.createThread(agentId, title);
    db.prepare(
      "INSERT INTO work_agent_threads (issue_key,agent_id,thread_id,created_at) VALUES (?,?,?,?)",
    ).run(issueKey, agentId, thread.id, now());
    return thread;
  },
  listThreads(agentId: string) {
    return (
      db
        .prepare(
          "SELECT * FROM threads WHERE agent_id=? ORDER BY updated_at DESC",
        )
        .all(agentId) as Row[]
    ).map(mapThread);
  },
  listThreadsByIds(ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) return [];
    const placeholders = uniqueIds.map(() => "?").join(",");
    return (
      db
        .prepare(`SELECT * FROM threads WHERE id IN (${placeholders})`)
        .all(...uniqueIds) as Row[]
    ).map(mapThread);
  },
  getThread(id: string) {
    const row = db.prepare("SELECT * FROM threads WHERE id=?").get(id) as
      Row | undefined;
    return row ? mapThread(row) : null;
  },
  createThread(agentId: string, title: string) {
    const id = randomUUID(),
      timestamp = now();
    db.prepare(
      "INSERT INTO threads (id,agent_id,title,created_at,updated_at) VALUES (?,?,?,?,?)",
    ).run(id, agentId, title, timestamp, timestamp);
    return conversationRepository.getThread(id)!;
  },
  setRuntimeThread(
    id: string,
    runtimeThreadId: string | null,
    runtime: string | null = null,
  ) {
    db.prepare(
      "UPDATE threads SET runtime_thread_id=?, runtime=?, updated_at=? WHERE id=?",
    ).run(runtimeThreadId, runtimeThreadId ? runtime : null, now(), id);
  },
  touchThread(id: string) {
    db.prepare("UPDATE threads SET updated_at=? WHERE id=?").run(now(), id);
  },
  listMessages(threadId: string) {
    return (
      db
        .prepare(
          "SELECT * FROM messages WHERE thread_id=? ORDER BY created_at,rowid",
        )
        .all(threadId) as Row[]
    ).map(mapMessage);
  },
  getRunInput(runId: string) {
    const row = db
      .prepare(
        "SELECT * FROM messages WHERE run_id=? AND role='user' ORDER BY rowid DESC LIMIT 1",
      )
      .get(runId) as Row | undefined;
    return row ? mapMessage(row) : null;
  },
  getRunAssistantOutput(runId: string) {
    const row = db
      .prepare(
        "SELECT * FROM messages WHERE run_id=? AND role='assistant' ORDER BY rowid DESC LIMIT 1",
      )
      .get(runId) as Row | undefined;
    return row ? mapMessage(row) : null;
  },
  addMessage(
    threadId: string,
    runId: string | null,
    role: Message["role"],
    body: string,
  ) {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO messages (id,thread_id,run_id,role,body,created_at) VALUES (?,?,?,?,?,?)",
    ).run(id, threadId, runId, role, body, now());
    conversationRepository.touchThread(threadId);
    return mapMessage(
      db.prepare("SELECT * FROM messages WHERE id=?").get(id) as Row,
    );
  },
  addRunMessageOnce(
    threadId: string,
    runId: string,
    role: Message["role"],
    body: string,
  ) {
    const insert = db.transaction(() => {
      const existing = db
        .prepare(
          "SELECT * FROM messages WHERE run_id=? AND role=? ORDER BY rowid LIMIT 1",
        )
        .get(runId, role) as Row | undefined;
      if (existing) return mapMessage(existing);
      const id = randomUUID();
      db.prepare(
        "INSERT INTO messages (id,thread_id,run_id,role,body,created_at) VALUES (?,?,?,?,?,?)",
      ).run(id, threadId, runId, role, body, now());
      conversationRepository.touchThread(threadId);
      return mapMessage(
        db.prepare("SELECT * FROM messages WHERE id=?").get(id) as Row,
      );
    });
    return insert.immediate();
  },
};
