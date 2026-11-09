import "server-only";

import { z } from "zod";
import { badRequest, conflict, notFound } from "@/lib/api";
import { autonomyRepository, type StoredProposal } from "@/lib/repositories/autonomy-repository";
import { agentRepository } from "@/lib/repositories/agent-repository";
import { automationRepository } from "@/lib/repositories/automation-repository";
import { cronExpressionSchema } from "@/lib/api-schemas/automation";
import { isValidTimeZone } from "@/lib/automation-schedule";
import { assertCanDirect, capability, logAutonomyEvent } from "@/lib/autonomy/service";
import type { Agent } from "@/lib/types";

/**
 * Changes that agents make to Slab itself. With self-management "draft" they wait
 * for the human; with "auto" Slab applies them at once. Agents can never change
 * permissions, integrations, budgets, or autonomy settings.
 */
export const PROPOSAL_KINDS = [
  "create_automation",
  "update_automation",
  "set_automation_enabled",
  "create_agent",
  "update_agent_instructions",
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

const timezone = z.string().trim().min(1).max(100).refine(isValidTimeZone, "Use a valid IANA timezone.");

export const proposalPayloadSchemas = {
  create_automation: z.object({
    name: z.string().trim().min(2).max(120),
    agentId: z.string().min(1),
    cronExpression: cronExpressionSchema,
    scheduleTimezone: timezone,
    prompt: z.string().trim().min(2).max(20_000),
    mode: z.enum(["review", "task"]),
  }),
  update_automation: z.object({
    automationId: z.string().min(1),
    name: z.string().trim().min(2).max(120).optional(),
    cronExpression: cronExpressionSchema.optional(),
    scheduleTimezone: timezone.optional(),
    prompt: z.string().trim().min(2).max(20_000).optional(),
    mode: z.enum(["review", "task"]).optional(),
  }),
  set_automation_enabled: z.object({ automationId: z.string().min(1), enabled: z.boolean() }),
  create_agent: z.object({
    name: z.string().trim().min(2).max(80),
    role: z.string().trim().min(2).max(500),
    instructions: z.string().trim().min(10).max(30_000),
  }),
  update_agent_instructions: z.object({
    agentId: z.string().min(1),
    role: z.string().trim().min(2).max(500).optional(),
    instructions: z.string().trim().min(10).max(30_000),
  }),
} satisfies Record<ProposalKind, z.ZodType>;

export type AutonomyProposal = Omit<StoredProposal, "kind"> & { kind: ProposalKind };

export function getProposal(id: string) {
  return autonomyRepository.getProposal(id) as AutonomyProposal | null;
}

export function listProposals(input: { status?: AutonomyProposal["status"]; limit?: number } = {}) {
  return autonomyRepository.listProposals(input) as AutonomyProposal[];
}

function slugFor(name: string) {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "agent";
  let slug = base;
  for (let index = 2; agentRepository.getAgent(slug); index += 1) slug = `${base}-${index}`;
  return slug;
}

function resolveAgentId(reference: string) {
  const agent = agentRepository.getAgent(reference);
  if (!agent) throw notFound(`Agent ${reference} not found.`);
  return agent;
}

/** Validates a proposal and returns its normalized payload, target, and summary. */
function prepare(kind: ProposalKind, raw: unknown, caller: Agent) {
  const payload = proposalPayloadSchemas[kind].parse(raw) as Record<string, unknown>;
  switch (kind) {
    case "create_automation": {
      const agent = resolveAgentId(String(payload.agentId));
      assertCanDirect(caller, agent);
      payload.agentId = agent.id;
      return { payload, targetId: null, summary: `Create automation "${String(payload.name)}" for ${agent.name} (${String(payload.cronExpression)}, ${String(payload.scheduleTimezone)})` };
    }
    case "update_automation":
    case "set_automation_enabled": {
      const automation = automationRepository.getAutomation(String(payload.automationId));
      if (!automation) throw notFound("Automation not found.");
      if (automation.triggerType !== "schedule")
        throw badRequest("Agents can only change schedule automations. Email and WhatsApp automations stay with the human.");
      assertCanDirect(caller, resolveAgentId(automation.agentId));
      return {
        payload,
        targetId: automation.id,
        summary:
          kind === "set_automation_enabled"
            ? `${payload.enabled ? "Enable" : "Pause"} automation "${automation.name}"`
            : `Change automation "${automation.name}"`,
      };
    }
    case "create_agent":
      return { payload, targetId: null, summary: `Create agent "${String(payload.name)}": ${String(payload.role)}` };
    case "update_agent_instructions": {
      const agent = resolveAgentId(String(payload.agentId));
      assertCanDirect(caller, agent);
      payload.agentId = agent.id;
      return { payload, targetId: agent.id, summary: `Change the instructions of ${agent.name}` };
    }
  }
}

function apply(proposal: AutonomyProposal, requester: { runtime: string; model: string; reasoningEffort: string } | null) {
  const payload = proposal.payload;
  switch (proposal.kind) {
    case "create_automation": {
      const automation = automationRepository.createAutomation({
        name: String(payload.name),
        agentId: String(payload.agentId),
        triggerType: "schedule",
        cronExpression: String(payload.cronExpression),
        scheduleTimezone: String(payload.scheduleTimezone),
        emailAccountId: null,
        prompt: String(payload.prompt),
        mode: payload.mode as "review" | "task",
        enabled: true,
      });
      return automation.id;
    }
    case "update_automation": {
      const updated = automationRepository.updateAutomation(String(payload.automationId), {
        ...(payload.name ? { name: String(payload.name) } : {}),
        ...(payload.cronExpression ? { cronExpression: String(payload.cronExpression) } : {}),
        ...(payload.scheduleTimezone ? { scheduleTimezone: String(payload.scheduleTimezone) } : {}),
        ...(payload.prompt ? { prompt: String(payload.prompt) } : {}),
        ...(payload.mode ? { mode: payload.mode as "review" | "task" } : {}),
      });
      if (!updated) throw notFound("Automation not found.");
      return updated.id;
    }
    case "set_automation_enabled": {
      const enabled = Boolean(payload.enabled);
      const updated = automationRepository.updateAutomation(String(payload.automationId), {
        enabled,
        lifecycleStatus: enabled ? "enabled" : "paused",
      });
      if (!updated) throw notFound("Automation not found.");
      return updated.id;
    }
    case "create_agent": {
      const agent = agentRepository.createAgent({
        name: String(payload.name),
        slug: slugFor(String(payload.name)),
        role: String(payload.role),
        instructions: String(payload.instructions),
        model: requester?.model ?? "default",
        runtime: requester?.runtime ?? "codex",
        reasoningEffort: (requester?.reasoningEffort ?? "default") as never,
        enabled: true,
        fullAccess: false,
        // Never more than "full": agents cannot create agents that skip the red lines.
        permissionMode: "full",
      });
      return agent.id;
    }
    case "update_agent_instructions": {
      const updated = agentRepository.updateAgent(String(payload.agentId), {
        instructions: String(payload.instructions),
        ...(payload.role ? { role: String(payload.role) } : {}),
      });
      if (!updated) throw notFound("Agent not found.");
      return updated.id;
    }
  }
}

/** Records a change requested by an agent; applies it now when self-management is automatic. */
export function proposeChange(input: { kind: ProposalKind; agentId: string; runId: string | null; payload: unknown }) {
  const mode = capability("self_manage", input.agentId);
  if (mode === "off") throw conflict("Self-management is off at this autonomy level.", "AUTONOMY_DISABLED");
  const caller = agentRepository.getAgent(input.agentId);
  if (!caller) throw notFound("Agent not found.");
  const prepared = prepare(input.kind, input.payload, caller);
  const { id } = autonomyRepository.createProposal({
    kind: input.kind,
    agentId: input.agentId,
    runId: input.runId,
    targetId: prepared.targetId,
    summary: prepared.summary,
    payload: prepared.payload,
  });
  const agent = agentRepository.getAgent(input.agentId);
  logAutonomyEvent({ kind: "proposal_created", actor: `agent:${agent?.slug ?? input.agentId}`, summary: prepared.summary, payload: { proposalId: id } });
  // Instruction changes rewrite how an agent behaves from then on: they always wait for the human.
  if (mode === "auto" && input.kind !== "update_agent_instructions")
    return decideProposal(id, "approve", `agent:${agent?.slug ?? input.agentId}`);
  return getProposal(id)!;
}

export function decideProposal(id: string, decision: "approve" | "reject", actor: string) {
  const proposal = getProposal(id);
  if (!proposal) throw notFound("Proposal not found.");
  if (proposal.status !== "pending") throw conflict("This proposal was already decided.");
  if (decision === "reject") {
    autonomyRepository.decideProposal(id, { status: "rejected", decidedBy: actor });
    logAutonomyEvent({ kind: "proposal_rejected", actor, summary: proposal.summary, payload: { proposalId: id } });
    return getProposal(id)!;
  }
  const requester = proposal.agentId ? agentRepository.getAgent(proposal.agentId) : null;
  try {
    const resultId = apply(proposal, requester);
    autonomyRepository.decideProposal(id, { status: "applied", decidedBy: actor, resultId });
    logAutonomyEvent({ kind: "proposal_applied", actor, summary: proposal.summary, payload: { proposalId: id, resultId } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    autonomyRepository.decideProposal(id, { status: "failed", decidedBy: actor, error: message.slice(0, 2_000) });
    logAutonomyEvent({ kind: "proposal_failed", actor, summary: `${proposal.summary}: ${message}`, payload: { proposalId: id } });
  }
  return getProposal(id)!;
}
