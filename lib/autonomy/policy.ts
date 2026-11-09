// Autonomy levels and capabilities. Pure: safe for server and client code.
//
// The level is a preset. Each capability can be set by hand, and an agent can be
// capped at a lower level. Level 1 with no overrides is exactly Slab before autonomy.

export const AUTONOMY_LEVELS = [0, 1, 2, 3] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const DEFAULT_AUTONOMY_LEVEL: AutonomyLevel = 1;

export const LEVEL_INFO: Record<AutonomyLevel, { name: string; summary: string }> = {
  0: {
    name: "Manual",
    summary: "Agents only answer when you use them. No automation, Work trigger, or loop runs on its own.",
  },
  1: {
    name: "Reactive",
    summary: "Automations (schedule, email, WhatsApp) and Work triggers run with each agent's tool policies. This is Slab without autonomy.",
  },
  2: {
    name: "Supervised",
    summary: "Agents also plan, schedule follow-ups, ask you on Telegram, start coding runs, and propose automations and agents as drafts. You approve the important steps.",
  },
  3: {
    name: "Autonomous",
    summary: "Agents run the business: they publish ready draft PRs, activate their own automations, and do outreach within limits. They only ask you when they need you, plus the red lines.",
  },
};

/** Values of each capability, ordered from least to most autonomous. */
export const CAPABILITY_VALUES = {
  triggers: ["off", "on"],
  planning: ["off", "on"],
  followups: ["off", "on"],
  ask_human: ["off", "on"],
  delegate: ["off", "on"],
  self_manage: ["off", "draft", "auto"],
  coding_start: ["human", "agent", "on_assign"],
  coding_gates: ["human", "auto"],
  outbound: ["off", "approval", "policy", "auto"],
  tool_approvals: ["policy", "auto"],
  approval_timeout: ["wait", "escalate", "deny"],
  memory_all_runs: ["off", "on"],
  guards: ["off", "on"],
} as const;

export type Capability = keyof typeof CAPABILITY_VALUES;
export type CapabilityValue<C extends Capability = Capability> =
  (typeof CAPABILITY_VALUES)[C][number];
export type Capabilities = { [C in Capability]: CapabilityValue<C> };

export const CAPABILITY_ORDER = Object.keys(CAPABILITY_VALUES) as Capability[];

export const CAPABILITY_INFO: Record<Capability, { label: string; description: string; values: Record<string, string> }> = {
  triggers: {
    label: "Triggers",
    description: "Automations (schedule, email, WhatsApp) and Work triggers (assignments, mentions, reviews).",
    values: { off: "Off", on: "On" },
  },
  planning: {
    label: "Planning loop",
    description: "The lead agent reviews the business every few hours, decides, and assigns work.",
    values: { off: "Off", on: "On" },
  },
  followups: {
    label: "Follow-ups",
    description: "Agents schedule their own follow-ups and wake-ups.",
    values: { off: "Off", on: "On" },
  },
  ask_human: {
    label: "Ask the human",
    description: "Agents ask you questions and send you updates on Telegram.",
    values: { off: "Off", on: "On" },
  },
  delegate: {
    label: "Delegation",
    description: "Agents start runs of other agents.",
    values: { off: "Off", on: "On" },
  },
  self_manage: {
    label: "Self-management",
    description: "Agents create or change automations and agents. Draft: you activate each change.",
    values: { off: "Off", draft: "Draft", auto: "Automatic" },
  },
  coding_start: {
    label: "Coding runs",
    description: "Who starts coding runs. On assignment: assigning a Work item to the Engineer starts one.",
    values: { human: "You", agent: "Agents", on_assign: "On assignment" },
  },
  coding_gates: {
    label: "Coding approvals",
    description: "Approving the spec and publishing the draft PR. Automatic: Slab publishes when the review is ready.",
    values: { human: "You", auto: "Automatic" },
  },
  outbound: {
    label: "Outbound messages",
    description: "New emails and WhatsApp messages that are not replies. Above the daily cap they ask you; the email service also caps new emails per account.",
    values: { off: "Off", approval: "Ask me", policy: "Agent setting", auto: "Automatic" },
  },
  tool_approvals: {
    label: "Tool approvals",
    description: "Tool calls that ask for approval. Automatic: Slab approves Work, Docs, email, calendar, and analytics tools, except the red lines. Custom integrations keep asking.",
    values: { policy: "Agent policy", auto: "Automatic" },
  },
  approval_timeout: {
    label: "Unanswered approvals",
    description: "What happens when an approval waits too long.",
    values: { wait: "Wait", escalate: "Remind me", deny: "Remind, then deny" },
  },
  memory_all_runs: {
    label: "Memory from every run",
    description: "Agents remember what they learn in automation and Work runs, not only in chats.",
    values: { off: "Chats only", on: "Every run" },
  },
  guards: {
    label: "Guards",
    description: "Run time limit, concurrency cap, delegation depth, and daily autonomous run cap.",
    values: { off: "Off", on: "On" },
  },
};

export const LEVEL_PRESETS: Record<AutonomyLevel, Capabilities> = {
  0: {
    triggers: "off",
    planning: "off",
    followups: "off",
    ask_human: "off",
    delegate: "off",
    self_manage: "off",
    coding_start: "human",
    coding_gates: "human",
    outbound: "off",
    tool_approvals: "policy",
    approval_timeout: "wait",
    memory_all_runs: "off",
    guards: "off",
  },
  1: {
    triggers: "on",
    planning: "off",
    followups: "off",
    ask_human: "off",
    delegate: "off",
    self_manage: "off",
    coding_start: "human",
    coding_gates: "human",
    outbound: "policy",
    tool_approvals: "policy",
    approval_timeout: "wait",
    memory_all_runs: "off",
    guards: "off",
  },
  2: {
    triggers: "on",
    planning: "on",
    followups: "on",
    ask_human: "on",
    delegate: "on",
    self_manage: "draft",
    coding_start: "agent",
    coding_gates: "human",
    outbound: "approval",
    tool_approvals: "policy",
    approval_timeout: "escalate",
    memory_all_runs: "on",
    guards: "on",
  },
  3: {
    triggers: "on",
    planning: "on",
    followups: "on",
    ask_human: "on",
    delegate: "on",
    self_manage: "auto",
    coding_start: "on_assign",
    coding_gates: "auto",
    outbound: "auto",
    tool_approvals: "auto",
    approval_timeout: "deny",
    memory_all_runs: "on",
    guards: "on",
  },
};

export type AutonomyLimits = {
  /** Hours between planning loops of the lead agent. */
  planningEveryHours: number;
  /** Local hour (0-23) for the daily Telegram digest; null turns it off. */
  digestHour: number | null;
  timezone: string;
  /** Guards. */
  maxConcurrentRuns: number;
  runTimeLimitMinutes: number;
  maxDelegationDepth: number;
  maxAutonomousRunsPerDay: number;
  /** Automatic outbound messages (new emails, WhatsApp) per day; above it they ask the human. */
  outboundDailyCap: number;
  /** Approval timeouts. */
  approvalRemindMinutes: number;
  approvalDenyHours: number;
  /** Hours a question to the human waits before the agent continues without an answer. */
  questionWaitHours: number;
};

export const DEFAULT_LIMITS: AutonomyLimits = {
  planningEveryHours: 6,
  digestHour: 9,
  timezone: "America/Argentina/Buenos_Aires",
  maxConcurrentRuns: 4,
  runTimeLimitMinutes: 60,
  maxDelegationDepth: 3,
  maxAutonomousRunsPerDay: 60,
  outboundDailyCap: 20,
  approvalRemindMinutes: 60,
  approvalDenyHours: 24,
  questionWaitHours: 24,
};

export type StoredAutonomyPolicy = {
  level?: number;
  overrides?: Partial<Record<string, string>>;
  limits?: Partial<AutonomyLimits>;
  /** Lead agent: runs the planning loop and answers free Telegram messages. */
  leadAgentId?: string | null;
  /** Planning prompt; empty uses the default. */
  planningPrompt?: string;
  /** Set while paused: the level to restore. */
  pausedFromLevel?: number | null;
  /** Per-agent maximum level. */
  agentCaps?: Record<string, number>;
};

export type AutonomyPolicy = {
  level: AutonomyLevel;
  paused: boolean;
  /** Level saved by the operator (restored on resume). */
  configuredLevel: AutonomyLevel;
  overrides: Partial<Capabilities>;
  capabilities: Capabilities;
  limits: AutonomyLimits;
  leadAgentId: string | null;
  planningPrompt: string;
  agentCaps: Record<string, AutonomyLevel>;
};

export function isAutonomyLevel(value: unknown): value is AutonomyLevel {
  return typeof value === "number" && (AUTONOMY_LEVELS as readonly number[]).includes(value);
}

export function isCapabilityValue<C extends Capability>(capability: C, value: unknown): value is CapabilityValue<C> {
  return typeof value === "string" && (CAPABILITY_VALUES[capability] as readonly string[]).includes(value);
}

function rank<C extends Capability>(capability: C, value: CapabilityValue<C>) {
  return (CAPABILITY_VALUES[capability] as readonly string[]).indexOf(value);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

export function normalizeLimits(input: Partial<AutonomyLimits> = {}): AutonomyLimits {
  const timezone =
    typeof input.timezone === "string" && isValidTimezone(input.timezone) ? input.timezone : DEFAULT_LIMITS.timezone;
  return {
    planningEveryHours: clampNumber(input.planningEveryHours, DEFAULT_LIMITS.planningEveryHours, 1, 168),
    digestHour:
      input.digestHour === null ? null : clampNumber(input.digestHour, DEFAULT_LIMITS.digestHour ?? 9, 0, 23),
    timezone,
    maxConcurrentRuns: clampNumber(input.maxConcurrentRuns, DEFAULT_LIMITS.maxConcurrentRuns, 1, 50),
    runTimeLimitMinutes: clampNumber(input.runTimeLimitMinutes, DEFAULT_LIMITS.runTimeLimitMinutes, 5, 720),
    maxDelegationDepth: clampNumber(input.maxDelegationDepth, DEFAULT_LIMITS.maxDelegationDepth, 1, 10),
    maxAutonomousRunsPerDay: clampNumber(input.maxAutonomousRunsPerDay, DEFAULT_LIMITS.maxAutonomousRunsPerDay, 1, 1000),
    outboundDailyCap: clampNumber(input.outboundDailyCap, DEFAULT_LIMITS.outboundDailyCap, 0, 1000),
    approvalRemindMinutes: clampNumber(input.approvalRemindMinutes, DEFAULT_LIMITS.approvalRemindMinutes, 5, 10_080),
    approvalDenyHours: clampNumber(input.approvalDenyHours, DEFAULT_LIMITS.approvalDenyHours, 1, 720),
    questionWaitHours: clampNumber(input.questionWaitHours, DEFAULT_LIMITS.questionWaitHours, 1, 720),
  };
}

export function isValidTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Resolves the stored policy. Missing or invalid values fall back to level 1 (Slab without autonomy). */
export function resolveAutonomyPolicy(stored: StoredAutonomyPolicy | null): AutonomyPolicy {
  const configuredLevel = isAutonomyLevel(stored?.level) ? stored.level : DEFAULT_AUTONOMY_LEVEL;
  const paused = isAutonomyLevel(stored?.pausedFromLevel);
  const level: AutonomyLevel = paused ? 0 : configuredLevel;
  const overrides: Partial<Capabilities> = {};
  for (const capability of CAPABILITY_ORDER) {
    const value = stored?.overrides?.[capability];
    if (isCapabilityValue(capability, value)) (overrides as Record<string, string>)[capability] = value;
  }
  // A pause ignores overrides: level 0 means nothing runs on its own.
  const capabilities = paused
    ? { ...LEVEL_PRESETS[0] }
    : ({ ...LEVEL_PRESETS[level], ...overrides } as Capabilities);
  const agentCaps: Record<string, AutonomyLevel> = {};
  for (const [agentId, cap] of Object.entries(stored?.agentCaps ?? {})) {
    if (isAutonomyLevel(cap)) agentCaps[agentId] = cap;
  }
  return {
    level,
    paused,
    configuredLevel: paused && isAutonomyLevel(stored?.pausedFromLevel) ? stored.pausedFromLevel : configuredLevel,
    overrides,
    capabilities,
    limits: normalizeLimits(stored?.limits),
    leadAgentId: typeof stored?.leadAgentId === "string" && stored.leadAgentId ? stored.leadAgentId : null,
    planningPrompt: typeof stored?.planningPrompt === "string" ? stored.planningPrompt : "",
    agentCaps,
  };
}

/**
 * Capabilities for one agent: each capability is the workspace value, limited to
 * the preset of the agent's maximum level.
 */
export function capabilitiesForAgent(policy: AutonomyPolicy, agentId: string | null | undefined): Capabilities {
  const cap = agentId ? policy.agentCaps[agentId] : undefined;
  if (cap === undefined || cap >= policy.level) return policy.capabilities;
  const ceiling = LEVEL_PRESETS[cap];
  const result = { ...policy.capabilities };
  for (const capability of CAPABILITY_ORDER) {
    const current = policy.capabilities[capability];
    const limit = ceiling[capability];
    if (rank(capability, current as never) > rank(capability, limit as never)) {
      (result as Record<string, string>)[capability] = limit;
    }
  }
  return result;
}

export const DEFAULT_PLANNING_PROMPT = [
  "Run the planning loop of the business.",
  "1. Review Slab Work: open items, blocked items, items waiting for review, and what changed since your last loop.",
  "2. Review the signals you can reach: support inbox, analytics, pull requests, and your notes in Docs.",
  "3. Decide the few actions that matter most now. Create or update Work items and assign them to the right agent.",
  "4. Schedule follow-ups for anything that needs a later check.",
  "5. Ask the human only when a decision needs them. Group questions.",
  "6. Write a short log of this loop (what you saw, what you decided) as a comment on your planning Work item or in Docs.",
  "If nothing needs action, finish without changes.",
].join("\n");
