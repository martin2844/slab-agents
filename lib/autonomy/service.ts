import "server-only";

import { badRequest } from "@/lib/api";
import { autonomyRepository, type AutonomyEvent } from "@/lib/repositories/autonomy-repository";
import { settingsRepository } from "@/lib/repositories/settings-repository";
import { agentRepository } from "@/lib/repositories/agent-repository";
import {
  CAPABILITY_ORDER,
  capabilitiesForAgent,
  isAutonomyLevel,
  isCapabilityValue,
  normalizeLimits,
  resolveAutonomyPolicy,
  type AutonomyLimits,
  type AutonomyPolicy,
  type Capability,
  type CapabilityValue,
  type StoredAutonomyPolicy,
} from "@/lib/autonomy/policy";

const POLICY_KEY = "autonomy_policy";

function readStored(): StoredAutonomyPolicy | null {
  const raw = settingsRepository.get(POLICY_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as StoredAutonomyPolicy) : null;
  } catch {
    return null;
  }
}

function writeStored(value: StoredAutonomyPolicy) {
  settingsRepository.set(POLICY_KEY, JSON.stringify(value));
}

export function getAutonomyPolicy(): AutonomyPolicy {
  return resolveAutonomyPolicy(readStored());
}

/** Value of one capability, for the workspace or limited to one agent's cap. */
export function capability<C extends Capability>(name: C, agentId?: string | null): CapabilityValue<C> {
  const policy = getAutonomyPolicy();
  return capabilitiesForAgent(policy, agentId)[name] as CapabilityValue<C>;
}

/** True when a capability is on (any value other than the least autonomous one). */
export function allows(name: Capability, agentId?: string | null) {
  const value = capability(name, agentId) as string;
  return !["off", "human", "policy", "wait"].includes(value);
}

export function autonomyLimits(): AutonomyLimits {
  return getAutonomyPolicy().limits;
}

export type { AutonomyEvent };

export function logAutonomyEvent(input: {
  kind: string;
  actor: string;
  summary: string;
  payload?: Record<string, unknown>;
}) {
  autonomyRepository.addEvent({ ...input, payload: input.payload ?? {} });
}

export function listAutonomyEvents(limit = 100): AutonomyEvent[] {
  return autonomyRepository.listEvents(limit);
}

export type AutonomyPolicyPatch = {
  level?: number;
  overrides?: Partial<Record<string, string | null>>;
  limits?: Partial<AutonomyLimits>;
  leadAgentId?: string | null;
  planningPrompt?: string;
  agentCaps?: Record<string, number | null>;
};

/** Operator change of the policy (Settings → Autonomy). */
export function updateAutonomyPolicy(patch: AutonomyPolicyPatch, actor = "operator") {
  const stored = readStored() ?? {};
  const next: StoredAutonomyPolicy = { ...stored };
  const changes: string[] = [];
  if (patch.level !== undefined) {
    if (!isAutonomyLevel(patch.level)) throw badRequest("Choose a level from 0 to 3.");
    if (isAutonomyLevel(stored.pausedFromLevel)) next.pausedFromLevel = patch.level;
    else next.level = patch.level;
    changes.push(`level ${patch.level}`);
  }
  if (patch.overrides) {
    const overrides = { ...(stored.overrides ?? {}) };
    for (const [key, value] of Object.entries(patch.overrides)) {
      if (!(CAPABILITY_ORDER as string[]).includes(key)) throw badRequest(`Unknown capability ${key}.`);
      if (value === null || value === undefined) {
        delete overrides[key];
        changes.push(`${key} = level default`);
        continue;
      }
      if (!isCapabilityValue(key as Capability, value)) throw badRequest(`Invalid value for ${key}.`);
      overrides[key] = value;
      changes.push(`${key} = ${value}`);
    }
    next.overrides = overrides;
  }
  if (patch.limits) {
    next.limits = normalizeLimits({ ...(stored.limits ?? {}), ...patch.limits });
    changes.push("limits");
  }
  if (patch.leadAgentId !== undefined) {
    if (patch.leadAgentId && !agentRepository.getAgent(patch.leadAgentId))
      throw badRequest("The lead agent does not exist.");
    next.leadAgentId = patch.leadAgentId ? agentRepository.getAgent(patch.leadAgentId)!.id : null;
    changes.push("lead agent");
  }
  if (patch.planningPrompt !== undefined) {
    next.planningPrompt = patch.planningPrompt.slice(0, 20_000);
    changes.push("planning prompt");
  }
  if (patch.agentCaps) {
    const caps = { ...(stored.agentCaps ?? {}) };
    for (const [agentId, cap] of Object.entries(patch.agentCaps)) {
      if (cap === null) delete caps[agentId];
      else if (isAutonomyLevel(cap)) caps[agentId] = cap;
      else throw badRequest("Agent caps must be a level from 0 to 3.");
    }
    next.agentCaps = caps;
    changes.push("agent caps");
  }
  writeStored(next);
  if (changes.length) {
    logAutonomyEvent({ kind: "policy_changed", actor, summary: `Autonomy policy changed: ${changes.join(", ")}.`, payload: { patch } });
  }
  return getAutonomyPolicy();
}

/** Stops everything that runs on its own (level 0) and remembers the level to restore. */
export function pauseAutonomy(actor = "operator") {
  const stored = readStored() ?? {};
  if (isAutonomyLevel(stored.pausedFromLevel)) return getAutonomyPolicy();
  const current = resolveAutonomyPolicy(stored).configuredLevel;
  writeStored({ ...stored, level: current, pausedFromLevel: current });
  logAutonomyEvent({ kind: "paused", actor, summary: `Autonomy paused (was level ${current}).` });
  return getAutonomyPolicy();
}

export function resumeAutonomy(actor = "operator") {
  const stored = readStored() ?? {};
  if (!isAutonomyLevel(stored.pausedFromLevel)) return getAutonomyPolicy();
  const level = stored.pausedFromLevel;
  writeStored({ ...stored, level, pausedFromLevel: null });
  logAutonomyEvent({ kind: "resumed", actor, summary: `Autonomy resumed at level ${level}.` });
  return getAutonomyPolicy();
}

/** Small key/value state for autonomy loops (last planning run, last digest, ...). */
export const autonomyState = {
  get(key: string) {
    return settingsRepository.get(`autonomy_state:${key}`);
  },
  set(key: string, value: string) {
    settingsRepository.set(`autonomy_state:${key}`, value);
  },
};

/** Runs that hold a runner slot now. */
export function activeRunCount() {
  return autonomyRepository.activeRunCount();
}

/** Effective autonomy level of one agent: the workspace level, limited by its cap. */
export function agentAutonomyLevel(agentId: string) {
  const policy = getAutonomyPolicy();
  return Math.min(policy.level, policy.agentCaps[agentId] ?? 3);
}

const PERMISSION_RANK: Record<string, number> = { guarded: 0, custom: 1, full: 2, yolo: 3 };

/**
 * An agent may only direct (delegate to, schedule, or change) agents that are
 * enabled, have no more permissions than itself, are not "yolo", and are allowed
 * to work autonomously (cap of level 2 or more).
 */
export function assertCanDirect(
  caller: { id: string; name: string; permissionMode: string },
  target: { id: string; name: string; enabled: boolean; permissionMode: string },
) {
  if (!target.enabled) throw badRequest(`${target.name} is disabled.`);
  if (target.permissionMode === "yolo")
    throw badRequest(`${target.name} runs without approvals; only the human can direct it.`);
  if ((PERMISSION_RANK[target.permissionMode] ?? 3) > (PERMISSION_RANK[caller.permissionMode] ?? 0))
    throw badRequest(`${target.name} has more permissions than ${caller.name}; only the human can direct it.`);
  if (target.id !== caller.id && agentAutonomyLevel(target.id) < 2)
    throw badRequest(`${target.name} is capped below autonomous work; only the human can direct it.`);
}
