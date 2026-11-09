import "server-only";

import { agentRepository } from "@/lib/repositories/agent-repository";
import { settingsRepository } from "@/lib/repositories/settings-repository";
import { CODING_PROMPTS } from "@/lib/coding/prompts";
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
  stage: AgentStage;
  reasoningEffort: ReasoningEffort;
};

const TEMPLATES: AgentTemplate[] = [
  {
    slug: "code-pm",
    name: "Code PM",
    role: "Turns Work items into clear product specs for coding runs.",
    stage: "pm",
    reasoningEffort: "high",
  },
  {
    slug: "code-tech-lead",
    name: "Tech Lead",
    role: "Plans code changes step by step from the product spec.",
    stage: "tech_spec",
    reasoningEffort: "high",
  },
  {
    slug: "code-plan-reviewer",
    name: "Plan Reviewer",
    role: "Scores implementation plans against a fixed rubric.",
    stage: "plan_review",
    reasoningEffort: "xhigh",
  },
  {
    slug: "code-engineer",
    name: "Engineer",
    role: "Implements approved plans on the run branch and runs the checks.",
    stage: "engineer",
    reasoningEffort: "medium",
  },
  {
    slug: "code-reviewer",
    name: "Code Reviewer",
    role: "Reviews and fixes the run branch before it is published.",
    stage: "code_review",
    reasoningEffort: "high",
  },
  {
    slug: "code-release-writer",
    name: "Release Writer",
    role: "Writes pull request descriptions for coding runs.",
    stage: "final_pass",
    reasoningEffort: "low",
  },
  {
    slug: "code-pr-fixer",
    name: "PR Fixer",
    role: "Handles review feedback and change requests on coding run branches.",
    stage: "pr_feedback",
    reasoningEffort: "medium",
  },
];

function chatInstructions() {
  return [
    CODING_PROMPTS.pr_feedback,
    "",
    "## Run chat",
    "",
    "When the stage contract says the stage is `chat`, follow these rules instead of the feedback steps:",
    "",
    CODING_PROMPTS.chat,
  ].join("\n");
}

/** Creates the default coding agents that do not exist yet. Existing agents are never changed. */
export function ensureCodingAgents() {
  const created: Agent[] = [];
  for (const template of TEMPLATES) {
    if (agentRepository.getAgent(template.slug)) continue;
    created.push(
      agentRepository.createAgent({
        name: template.name,
        slug: template.slug,
        role: template.role,
        instructions:
          template.stage === "pr_feedback"
            ? chatInstructions()
            : CODING_PROMPTS[template.stage],
        model: "default",
        enabled: true,
        fullAccess: false,
        runtime: "codex",
        reasoningEffort: template.reasoningEffort,
        permissionMode: "full",
      }),
    );
  }
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

export function agentForStage(stage: AgentStage) {
  const reference =
    getStageAgentOverrides()[stage] ?? DEFAULT_STAGE_AGENT_SLUGS[stage];
  return agentRepository.getAgent(reference);
}
