import "server-only";

import { db, now } from "@/lib/db/database";
import { withImmediateTransaction } from "@/lib/db/transaction";
import { OperationalError } from "@/lib/operational-error";
import type { Row } from "@/lib/repositories/repository-helpers";
import type {
  AgentToolPolicy,
  RunToolPolicySnapshot,
  ToolPolicyMode,
} from "@/lib/types";

const modes = new Set<ToolPolicyMode>(["approve", "prompt", "deny"]);
const policyName = /^[A-Za-z0-9_.:-]{1,200}$/;

function corruptPolicy(): never {
  throw new Error("Stored agent tool policy is corrupt.");
}

function parseStoredObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value) return corruptPolicy();
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return corruptPolicy();
    }
    return parsed as Record<string, unknown>;
  } catch {
    return corruptPolicy();
  }
}

function parseTools(value: unknown): Record<string, ToolPolicyMode> {
  const parsed = parseStoredObject(value);
  const entries = Object.entries(parsed);
  if (
    entries.length > 500 ||
    entries.some(
      ([tool, mode]) =>
        !policyName.test(tool) || !modes.has(mode as ToolPolicyMode),
    )
  ) {
    return corruptPolicy();
  }
  return Object.fromEntries(entries) as Record<string, ToolPolicyMode>;
}

function parseMode(value: unknown): ToolPolicyMode {
  if (!modes.has(value as ToolPolicyMode)) return corruptPolicy();
  return value as ToolPolicyMode;
}

function parseSnapshotPolicies(
  value: unknown,
): RunToolPolicySnapshot["policies"] {
  const parsed = parseStoredObject(value);
  return Object.fromEntries(
    Object.entries(parsed).map(([serverName, raw]) => {
      if (
        !policyName.test(serverName) ||
        !raw ||
        typeof raw !== "object" ||
        Array.isArray(raw)
      ) {
        return corruptPolicy();
      }
      const policy = raw as Record<string, unknown>;
      return (
        [
          serverName,
          {
            defaultMode: parseMode(policy.defaultMode),
            tools: parseTools(policy.tools),
          },
        ] as const
      );
    }),
  );
}

function mapPolicy(row: Row): AgentToolPolicy {
  return {
    agentId: String(row.agent_id),
    serverName: String(row.server_name),
    defaultMode: parseMode(row.default_mode),
    tools: parseTools(row.tools_json),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapSnapshot(row: Row): RunToolPolicySnapshot {
  return {
    runId: String(row.run_id),
    agentId: String(row.agent_id),
    policies: parseSnapshotPolicies(row.policies_json),
    capturedAt: String(row.captured_at),
  } as RunToolPolicySnapshot;
}

export const agentToolPolicyRepository = {
  listAll() {
    return (
      db
        .prepare(
          "SELECT * FROM agent_tool_policies ORDER BY agent_id, server_name",
        )
        .all() as Row[]
    ).map(mapPolicy);
  },

  listForAgent(agentId: string) {
    return (
      db
        .prepare(
          "SELECT * FROM agent_tool_policies WHERE agent_id=? ORDER BY server_name",
        )
        .all(agentId) as Row[]
    ).map(mapPolicy);
  },

  get(agentId: string, serverName: string) {
    const row = db
      .prepare(
        "SELECT * FROM agent_tool_policies WHERE agent_id=? AND server_name=?",
      )
      .get(agentId, serverName) as Row | undefined;
    return row ? mapPolicy(row) : null;
  },

  save(input: {
    agentId: string;
    serverName: string;
    defaultMode: ToolPolicyMode;
    tools: Record<string, ToolPolicyMode>;
    expectedVersion: number;
  }) {
    return withImmediateTransaction(() => {
      const current = agentToolPolicyRepository.get(
        input.agentId,
        input.serverName,
      );
      const timestamp = now();
      if (!current) {
        if (input.expectedVersion !== 0) {
          throw new OperationalError(
            "Tool policy changed. Reload the current agent permissions.",
            "VERSION_CONFLICT",
            409,
          );
        }
        db.prepare(
          `INSERT INTO agent_tool_policies
           (agent_id,server_name,default_mode,tools_json,version,created_at,updated_at)
           VALUES (?,?,?,?,1,?,?)`,
        ).run(
          input.agentId,
          input.serverName,
          input.defaultMode,
          JSON.stringify(input.tools),
          timestamp,
          timestamp,
        );
      } else {
        const updated = db
          .prepare(
            `UPDATE agent_tool_policies
             SET default_mode=?,tools_json=?,version=version+1,updated_at=?
             WHERE agent_id=? AND server_name=? AND version=?`,
          )
          .run(
            input.defaultMode,
            JSON.stringify(input.tools),
            timestamp,
            input.agentId,
            input.serverName,
            input.expectedVersion,
          );
        if (updated.changes !== 1) {
          throw new OperationalError(
            "Tool policy changed. Reload the current agent permissions.",
            "VERSION_CONFLICT",
            409,
          );
        }
      }
      db.prepare(
        "UPDATE agents SET permission_mode='custom',full_access=0,updated_at=? WHERE id=?",
      ).run(timestamp, input.agentId);
      return agentToolPolicyRepository.get(input.agentId, input.serverName)!;
    });
  },

  getRunSnapshot(runId: string) {
    const row = db
      .prepare("SELECT * FROM run_tool_policy_snapshots WHERE run_id=?")
      .get(runId) as Row | undefined;
    return row ? mapSnapshot(row) : null;
  },

  getOrCreateRunSnapshot(input: {
    runId: string;
    agentId: string;
    policies: RunToolPolicySnapshot["policies"];
  }) {
    return withImmediateTransaction(() => {
      const run = db
        .prepare("SELECT agent_id FROM runs WHERE id=?")
        .get(input.runId) as Row | undefined;
      if (!run || String(run.agent_id) !== input.agentId) {
        throw new OperationalError(
          "Run capability snapshot does not belong to this agent.",
          "CAPABILITY_SNAPSHOT_MISMATCH",
          409,
        );
      }
      const existing = agentToolPolicyRepository.getRunSnapshot(input.runId);
      if (existing) {
        if (existing.agentId !== input.agentId) {
          throw new OperationalError(
            "Run capability snapshot does not belong to this agent.",
            "CAPABILITY_SNAPSHOT_MISMATCH",
            409,
          );
        }
        return { snapshot: existing, created: false as const };
      }
      const capturedAt = now();
      db.prepare(
        `INSERT INTO run_tool_policy_snapshots
         (run_id,agent_id,policies_json,captured_at) VALUES (?,?,?,?)`,
      ).run(
        input.runId,
        input.agentId,
        JSON.stringify(input.policies),
        capturedAt,
      );
      return {
        snapshot: agentToolPolicyRepository.getRunSnapshot(input.runId)!,
        created: true as const,
      };
    });
  },
};
