import "server-only";

import { agentRepository } from "@/lib/repositories/agent-repository";
import { settingsRepository } from "@/lib/repositories/settings-repository";
import {
  AGENT_STAGES,
  DEFAULT_STAGE_AGENT_SLUGS,
  type AgentStage,
} from "@/lib/coding/stages";
import type { ReasoningEffort } from "@/lib/runtime-reasoning";
import type { Agent } from "@/lib/types";

const STAGE_AGENT_SETTING = "coding_stage_agents";

type AgentTemplate = {
  slug: string;
  name: string;
  role: string;
  instructions: string;
  reasoningEffort: ReasoningEffort;
};

// General instructions only. Each stage sends its own instructions with every run
// (lib/coding/prompts.ts), so one agent can run several stages.
const TEMPLATES: AgentTemplate[] = [
  {
    slug: "code-pm",
    name: "Code PM",
    role: "Product manager of Slab coding runs: turns Work items into clear product specs.",
    instructions: [
      "You are the product manager of Slab coding runs.",
      "",
      "- Each run gives you the instructions of its stage and a stage contract. Follow them exactly.",
      "- Understand the problem before the solution. Read the Work item, its comments and links, Slab Docs, and the code.",
      "- Ask only what the sources cannot answer. Give options when the answer has a few likely values.",
      "- Write acceptance criteria that an engineer can test.",
      "- Never change code. Never change the status or the fields of Work items.",
      "- Write in Simplified Technical English: active voice, short sentences, one idea per sentence.",
    ].join("\n"),
    reasoningEffort: "high",
  },
  {
    slug: "code-engineer",
    name: "Engineer",
    role: "Software engineer of Slab coding runs: plans, reviews, implements, and ships code changes.",
    instructions: [
      "You are the software engineer of Slab coding runs. You plan, review, implement, and fix code changes.",
      "",
      "- Each run gives you the instructions of its stage and a stage contract. Follow them exactly. The stage decides your role: tech lead, plan reviewer, engineer, code reviewer, release writer, or PR fixer.",
      "- Read the repository rules first: AGENTS.md, CLAUDE.md, CONTRIBUTING.md, the lint config, and the code around the change.",
      "- Match the conventions of the code around the change. Reuse current functions before you add new ones.",
      "- Keep changes small and focused on the Work item. Do not refactor unrelated code.",
      "- Run the checks that cover your change. Never report a check as passing when you did not run it.",
      "- Never push, never open pull requests, never call the GitHub API, and never edit .github/workflows/. Slab publishes after human review.",
      "- Write in Simplified Technical English: active voice, short sentences, one idea per sentence.",
    ].join("\n"),
    reasoningEffort: "high",
  },
];

/**
 * Creates the default coding agents that do not exist yet (existing agents are never
 * changed) and assigns them to every stage.
 */
export function ensureCodingAgents(options: { assign?: boolean } = {}) {
  const created: Agent[] = [];
  for (const template of TEMPLATES) {
    if (agentRepository.getAgent(template.slug)) continue;
    created.push(
      agentRepository.createAgent({
        name: template.name,
        slug: template.slug,
        role: template.role,
        instructions: template.instructions,
        model: "default",
        enabled: true,
        fullAccess: false,
        runtime: "codex",
        reasoningEffort: template.reasoningEffort,
        permissionMode: "full",
      }),
    );
  }
  if (options.assign) setStageAgentOverrides({});
  return created;
}

export function getStageAgentOverrides(): Partial<Record<AgentStage, string>> {
  const raw = settingsRepository.get(STAGE_AGENT_SETTING);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([stage, value]) =>
          (AGENT_STAGES as string[]).includes(stage) && typeof value === "string",
      ),
    ) as Partial<Record<AgentStage, string>>;
  } catch {
    return {};
  }
}

export function setStageAgentOverrides(value: Partial<Record<AgentStage, string>>) {
  settingsRepository.set(STAGE_AGENT_SETTING, JSON.stringify(value));
}

export function stageAgentMapping() {
  const overrides = getStageAgentOverrides();
  return AGENT_STAGES.map((stage) => {
    const reference = overrides[stage] ?? DEFAULT_STAGE_AGENT_SLUGS[stage];
    const agent = agentRepository.getAgent(reference);
    return { stage, reference, agent };
  });
}

/** True when the agent works one of the coding stages (it needs a coding run's checkout). */
export function isCodingStageAgent(agentId: string) {
  return AGENT_STAGES.some((stage) => agentForStage(stage)?.id === agentId);
}

export function agentForStage(stage: AgentStage) {
  const reference =
    getStageAgentOverrides()[stage] ?? DEFAULT_STAGE_AGENT_SLUGS[stage];
  return agentRepository.getAgent(reference);
}
