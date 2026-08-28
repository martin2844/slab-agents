import "server-only";

import { randomUUID } from "node:crypto";

import {
  automationWorkflowStepsSchema,
  emailAutomationMatchSchema,
} from "@/lib/automation-workflow";
import { db, now } from "@/lib/db/database";
import { withImmediateTransaction } from "@/lib/db/transaction";
import { type Row } from "@/lib/repositories/repository-helpers";
import type {
  AutomationExecution,
  AutomationExecutionStatus,
  AutomationStepExecution,
  InboundEmailEvent,
} from "@/lib/types";

function mapExecution(row: Row): AutomationExecution {
  const rawDefinition = JSON.parse(String(row.definition_json)) as {
    mode?: unknown;
    emailMatch: unknown;
    steps: unknown;
  };
  return {
    id: String(row.id),
    automationId: row.automation_id ? String(row.automation_id) : null,
    automationName: String(row.automation_name),
    definitionVersion: Number(row.definition_version),
    definition: {
      mode: rawDefinition.mode === "review" ? "review" : "task",
      emailMatch: emailAutomationMatchSchema.parse(rawDefinition.emailMatch),
      steps: automationWorkflowStepsSchema.parse(rawDefinition.steps),
    },
    event: JSON.parse(String(row.event_json)) as InboundEmailEvent,
    conversationKey: String(row.conversation_key),
    status: row.status as AutomationExecutionStatus,
    currentStepIndex: Number(row.current_step_index),
    error: row.error ? String(row.error) : null,
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

function mapStep(row: Row): AutomationStepExecution {
  return {
    executionId: String(row.execution_id),
    stepId: String(row.step_id),
    stepIndex: Number(row.step_index),
    stepType: row.step_type as AutomationStepExecution["stepType"],
    agentId: String(row.agent_id),
    agentName: String(row.agent_name),
    action: row.action as AutomationStepExecution["action"],
    runId: row.run_id ? String(row.run_id) : null,
    status: row.status as AutomationStepExecution["status"],
    error: row.error ? String(row.error) : null,
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

const terminalExecutionStatuses: AutomationExecutionStatus[] = [
  "completed",
  "failed",
  "skipped",
];

export const automationExecutionRepository = {
  getExecution(id: string) {
    const row = db
      .prepare("SELECT * FROM automation_executions WHERE id=?")
      .get(id) as Row | undefined;
    return row ? mapExecution(row) : null;
  },

  listForAutomation(automationId: string, limit = 50) {
    return (
      db
        .prepare(
          `SELECT * FROM automation_executions
           WHERE automation_id=? ORDER BY created_at DESC,rowid DESC LIMIT ?`,
        )
        .all(automationId, limit) as Row[]
    ).map(mapExecution);
  },

  listActive() {
    return (
      db
        .prepare(
          `SELECT * FROM automation_executions
           WHERE status IN ('pending','running','waiting_approval')
           ORDER BY created_at,rowid`,
        )
        .all() as Row[]
    ).map(mapExecution);
  },

  getActiveConversation(automationId: string, conversationKey: string) {
    const row = db
      .prepare(
        `SELECT * FROM automation_executions
         WHERE automation_id=? AND conversation_key=?
           AND status IN ('pending','running','waiting_approval')
         ORDER BY created_at,rowid LIMIT 1`,
      )
      .get(automationId, conversationKey) as Row | undefined;
    return row ? mapExecution(row) : null;
  },

  listSteps(executionId: string) {
    return (
      db
        .prepare(
          `SELECT * FROM automation_step_executions
           WHERE execution_id=? ORDER BY step_index`,
        )
        .all(executionId) as Row[]
    ).map(mapStep);
  },

  createEmailExecution(input: {
    id?: string;
    automationId: string;
    automationName: string;
    definitionVersion: number;
    definition: AutomationExecution["definition"];
    event: InboundEmailEvent;
    conversationKey: string;
    stepAgents: Array<{ id: string; name: string }>;
  }) {
    return withImmediateTransaction(() => {
      const active = automationExecutionRepository.getActiveConversation(
        input.automationId,
        input.conversationKey,
      );
      if (active) return { created: false as const, active };
      const id = input.id ?? randomUUID();
      const timestamp = now();
      db.prepare(
        `INSERT INTO automation_executions
         (id,automation_id,automation_name,definition_version,definition_json,event_json,conversation_key,status,current_step_index,error,created_at,started_at,completed_at)
         VALUES (?,?,?,?,?,?,?,'pending',0,NULL,?,NULL,NULL)`,
      ).run(
        id,
        input.automationId,
        input.automationName,
        input.definitionVersion,
        JSON.stringify(input.definition),
        JSON.stringify(input.event),
        input.conversationKey,
        timestamp,
      );
      const insertStep = db.prepare(
        `INSERT INTO automation_step_executions
         (execution_id,step_id,step_index,step_type,agent_id,agent_name,action,run_id,status,error,created_at,started_at,completed_at)
         VALUES (?,?,?,?,?,?,?,NULL,'pending',NULL,?,NULL,NULL)`,
      );
      input.definition.steps.forEach((step, index) => {
        const agent = input.stepAgents.find(({ id: agentId }) =>
          agentId === step.agentId,
        );
        if (!agent) throw new Error("Workflow step agent snapshot is missing.");
        insertStep.run(
          id,
          step.id,
          index,
          step.type,
          step.agentId,
          agent.name,
          step.action,
          timestamp,
        );
      });
      return {
        created: true as const,
        execution: automationExecutionRepository.getExecution(id)!,
      };
    });
  },

  attachOccurrence(
    automationId: string,
    inboundEventId: number,
    executionId: string,
  ) {
    return db
      .prepare(
        `UPDATE email_automation_occurrences SET execution_id=?
         WHERE automation_id=? AND inbound_event_id=?
           AND status='pending' AND execution_id IS NULL`,
      )
      .run(executionId, automationId, inboundEventId).changes;
  },

  startStep(input: {
    executionId: string;
    stepId: string;
    stepIndex: number;
    runId: string;
  }) {
    const timestamp = now();
    const changed = db
      .prepare(
        `UPDATE automation_step_executions
         SET run_id=?,status='running',started_at=?,error=NULL
         WHERE execution_id=? AND step_id=? AND step_index=?
           AND status='pending' AND run_id IS NULL`,
      )
      .run(
        input.runId,
        timestamp,
        input.executionId,
        input.stepId,
        input.stepIndex,
      ).changes;
    if (changed !== 1) return false;
    db.prepare(
      `UPDATE automation_executions
       SET status='running',current_step_index=?,started_at=COALESCE(started_at,?),error=NULL
       WHERE id=? AND status IN ('pending','running','waiting_approval')`,
    ).run(input.stepIndex, timestamp, input.executionId);
    return true;
  },

  syncWaitingState(
    executionId: string,
    stepId: string,
    waiting: boolean,
  ) {
    const from = waiting ? "running" : "waiting_approval";
    const to = waiting ? "waiting_approval" : "running";
    return withImmediateTransaction(() => {
      const changed = db
        .prepare(
          `UPDATE automation_step_executions SET status=?
           WHERE execution_id=? AND step_id=? AND status=?`,
        )
        .run(to, executionId, stepId, from).changes;
      if (changed) {
        db.prepare(
          `UPDATE automation_executions SET status=?
           WHERE id=? AND status=?`,
        ).run(to, executionId, from);
      }
      return changed;
    });
  },

  completeStep(executionId: string, stepId: string) {
    return db
      .prepare(
        `UPDATE automation_step_executions
         SET status='completed',completed_at=?,error=NULL
         WHERE execution_id=? AND step_id=?
           AND status IN ('running','waiting_approval')`,
      )
      .run(now(), executionId, stepId).changes;
  },

  finishExecution(
    executionId: string,
    status: Extract<AutomationExecutionStatus, "completed" | "failed" | "skipped">,
    error: string | null = null,
  ) {
    return db
      .prepare(
        `UPDATE automation_executions
         SET status=?,error=?,completed_at=?
         WHERE id=? AND status IN ('pending','running','waiting_approval')`,
      )
      .run(status, error?.slice(0, 1_000) ?? null, now(), executionId).changes;
  },

  failStep(
    executionId: string,
    stepId: string,
    status: "failed" | "skipped",
    error: string,
  ) {
    return db
      .prepare(
        `UPDATE automation_step_executions
         SET status=?,error=?,completed_at=?
         WHERE execution_id=? AND step_id=?
           AND status IN ('pending','running','waiting_approval')`,
      )
      .run(status, error.slice(0, 1_000), now(), executionId, stepId).changes;
  },

  isTerminal(status: AutomationExecutionStatus) {
    return terminalExecutionStatuses.includes(status);
  },
};
