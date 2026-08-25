import "server-only";

import { randomUUID } from "node:crypto";
import { db, now } from "@/lib/db/database";
import { bool, type Row } from "@/lib/repositories/repository-helpers";
import type { Agent, AgentQuickAction } from "@/lib/types";

function mapAgent(row: Row): Agent {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    role: String(row.role),
    instructions: String(row.instructions),
    runtime: String(row.runtime ?? "codex"),
    model: String(row.model),
    enabled: bool(row.enabled),
    fullAccess: bool(row.full_access),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapAgentQuickAction(row: Row): AgentQuickAction {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    label: String(row.label),
    prompt: String(row.prompt),
    position: Number(row.position),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export const agentRepository = {
  listAgents() {
    return (
      db
        .prepare("SELECT * FROM agents ORDER BY enabled DESC, name")
        .all() as Row[]
    ).map(mapAgent);
  },
  getAgent(id: string) {
    const row = db
      .prepare("SELECT * FROM agents WHERE id = ? OR slug = ?")
      .get(id, id) as Row | undefined;
    return row ? mapAgent(row) : null;
  },
  createAgent(
    input: Pick<
      Agent,
      | "name"
      | "slug"
      | "role"
      | "instructions"
      | "model"
      | "enabled"
      | "fullAccess"
    > & { runtime?: string },
  ) {
    const id = randomUUID(),
      timestamp = now();
    db.prepare(
      "INSERT INTO agents (id,name,slug,role,instructions,runtime,model,enabled,full_access,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      input.name,
      input.slug,
      input.role,
      input.instructions,
      input.runtime ?? "codex",
      input.model,
      input.enabled ? 1 : 0,
      input.fullAccess ? 1 : 0,
      timestamp,
      timestamp,
    );
    return agentRepository.getAgent(id)!;
  },
  listAgentQuickActions(agentId?: string) {
    const rows = agentId
      ? db
          .prepare(
            "SELECT * FROM agent_quick_actions WHERE agent_id=? ORDER BY position,label",
          )
          .all(agentId)
      : db
          .prepare(
            "SELECT * FROM agent_quick_actions ORDER BY agent_id,position,label",
          )
          .all();
    return (rows as Row[]).map(mapAgentQuickAction);
  },
  getAgentQuickAction(id: string) {
    const row = db
      .prepare("SELECT * FROM agent_quick_actions WHERE id=?")
      .get(id) as Row | undefined;
    return row ? mapAgentQuickAction(row) : null;
  },
  getAgentQuickActionByLabel(agentId: string, label: string) {
    const row = db
      .prepare("SELECT * FROM agent_quick_actions WHERE agent_id=? AND label=?")
      .get(agentId, label) as Row | undefined;
    return row ? mapAgentQuickAction(row) : null;
  },
  createAgentQuickAction(
    agentId: string,
    input: Pick<AgentQuickAction, "label" | "prompt">,
  ) {
    const id = randomUUID();
    const timestamp = now();
    const position = Number(
      (
        db
          .prepare(
            "SELECT COALESCE(MAX(position),-1)+1 AS position FROM agent_quick_actions WHERE agent_id=?",
          )
          .get(agentId) as Row
      ).position,
    );
    db.prepare(
      "INSERT INTO agent_quick_actions (id,agent_id,label,prompt,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    ).run(
      id,
      agentId,
      input.label,
      input.prompt,
      position,
      timestamp,
      timestamp,
    );
    return agentRepository.getAgentQuickAction(id)!;
  },
  updateAgentQuickAction(
    id: string,
    input: Partial<Pick<AgentQuickAction, "label" | "prompt">>,
  ) {
    const current = agentRepository.getAgentQuickAction(id);
    if (!current) return null;
    db.prepare(
      "UPDATE agent_quick_actions SET label=?,prompt=?,updated_at=? WHERE id=?",
    ).run(
      input.label ?? current.label,
      input.prompt ?? current.prompt,
      now(),
      id,
    );
    return agentRepository.getAgentQuickAction(id);
  },
  deleteAgentQuickAction(id: string) {
    return db.prepare("DELETE FROM agent_quick_actions WHERE id=?").run(id)
      .changes;
  },
  updateAgent(
    id: string,
    input: Partial<
      Pick<
        Agent,
        | "name"
        | "slug"
        | "role"
        | "instructions"
        | "runtime"
        | "model"
        | "enabled"
        | "fullAccess"
      >
    >,
  ) {
    const current = agentRepository.getAgent(id);
    if (!current) return null;
    db.prepare(
      "UPDATE agents SET name=?, slug=?, role=?, instructions=?, runtime=?, model=?, enabled=?, full_access=?, updated_at=? WHERE id=?",
    ).run(
      input.name ?? current.name,
      input.slug ?? current.slug,
      input.role ?? current.role,
      input.instructions ?? current.instructions,
      input.runtime ?? current.runtime,
      input.model ?? current.model,
      (input.enabled ?? current.enabled) ? 1 : 0,
      (input.fullAccess ?? current.fullAccess) ? 1 : 0,
      now(),
      current.id,
    );
    return agentRepository.getAgent(current.id);
  },
};
