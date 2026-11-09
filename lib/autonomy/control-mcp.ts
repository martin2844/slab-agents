import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { autonomyRepository } from "@/lib/repositories/autonomy-repository";
import { agentRepository } from "@/lib/repositories/agent-repository";
import { automationRepository } from "@/lib/repositories/automation-repository";
import { runRepository } from "@/lib/repositories/run-repository";
import { internalRoute } from "@/lib/server-config";
import { assertCanDirect, capability } from "@/lib/autonomy/service";
import { createHumanRequest } from "@/lib/autonomy/human-requests";
import { cancelFollowup, listFollowups, scheduleFollowup } from "@/lib/autonomy/followups";
import { startAutonomyRun } from "@/lib/autonomy/runs";
import { proposeChange, type ProposalKind } from "@/lib/autonomy/proposals";
import { codingRepository } from "@/lib/repositories/coding-repository";

export const CONTROL_SERVER_NAME = "slab";

type ToolSpec = {
  name: string;
  description: string;
  enabled: (agentId: string) => boolean;
};

const on = (name: Parameters<typeof capability>[0]) => (agentId: string) =>
  !["off", "human", "policy", "wait"].includes(capability(name, agentId) as string);

/** Tools of the Slab control server and the capability that turns each one on. */
export const CONTROL_TOOLS: ToolSpec[] = [
  {
    name: "ask_human",
    description:
      "Ask the human a question and stop. Use it only when a decision needs them. Slab sends it on Telegram and starts a new run with the answer (or without one after the wait time). End your run right after you ask.",
    enabled: on("ask_human"),
  },
  {
    name: "notify_human",
    description: "Send the human a short update that needs no answer (for example: a PR is ready for review and builds).",
    enabled: on("ask_human"),
  },
  {
    name: "schedule_followup",
    description: "Schedule a run of yourself later to check something. Give `in_hours` or an ISO `at` time, and a note that says exactly what to check.",
    enabled: on("followups"),
  },
  { name: "list_followups", description: "List your pending follow-ups.", enabled: on("followups") },
  { name: "cancel_followup", description: "Cancel one of your pending follow-ups.", enabled: on("followups") },
  {
    name: "list_agents",
    description: "List the agents of the workspace (slug, name, role).",
    enabled: (agentId) => on("delegate")(agentId) || on("self_manage")(agentId) || on("coding_start")(agentId),
  },
  {
    name: "start_agent_run",
    description: "Start a run of another agent with a task. Prefer assigning a Work item when the work needs tracking.",
    enabled: on("delegate"),
  },
  {
    name: "start_coding_run",
    description: "Start a Slab coding run for a Work item: PM, plan, engineer, code review, and a draft pull request.",
    enabled: on("coding_start"),
  },
  { name: "list_automations", description: "List automations (id, name, agent, schedule, enabled).", enabled: on("self_manage") },
  {
    name: "create_automation",
    description: "Create a schedule automation for an agent. Depending on the autonomy level it is applied now or waits for the human.",
    enabled: on("self_manage"),
  },
  { name: "update_automation", description: "Change a schedule automation.", enabled: on("self_manage") },
  { name: "set_automation_enabled", description: "Enable or pause a schedule automation.", enabled: on("self_manage") },
  {
    name: "create_agent",
    description: "Create a new agent (name, role, instructions). It cannot get integrations or more permissions than \"full\".",
    enabled: on("self_manage"),
  },
  { name: "update_agent_instructions", description: "Propose new instructions (and role) for an agent. The human always approves instruction changes.", enabled: on("self_manage") },
];

export function controlToolsForAgent(agentId: string) {
  return CONTROL_TOOLS.filter((tool) => tool.enabled(agentId)).map(({ name }) => name);
}

function hash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** MCP server definition for a run, or null when no control tool is on for the agent. */
export function issueControlServer(runId: string, agentId: string) {
  const tools = controlToolsForAgent(agentId);
  if (!tools.length) return null;
  const token = randomBytes(32).toString("base64url");
  autonomyRepository.saveControlToken(runId, agentId, hash(token));
  return {
    tools,
    server: {
      name: CONTROL_SERVER_NAME,
      url: internalRoute(`/api/autonomy/mcp?run=${encodeURIComponent(runId)}`),
      credentials: { bearerToken: token },
    },
  };
}

function authorize(runId: string, token: string) {
  const row = autonomyRepository.getControlToken(runId);
  if (!row || !token) return null;
  const actual = Buffer.from(hash(token), "hex");
  const expected = Buffer.from(row.tokenHash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  const run = runRepository.getRun(runId);
  if (!run || run.agentId !== row.agentId || !["running", "waiting_approval"].includes(run.status)) return null;
  const agent = agentRepository.getAgent(run.agentId);
  return agent ? { run, agent } : null;
}

function result(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }],
    ...(isError ? { isError: true } : {}),
  };
}

function agentReference(reference: string) {
  const agent = agentRepository.getAgent(reference.trim());
  if (!agent) throw new Error(`Agent "${reference}" not found. Use list_agents.`);
  return agent;
}

export async function handleControlMcpRequest(request: Request, runId: string) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const initial = authorize(runId, token);
  if (!initial) return new Response("Unauthorized", { status: 401 });
  const server = new McpServer({ name: "slab-control", version: "1.0.0" });
  const tools = new Set(controlToolsForAgent(initial.agent.id));

  const register = <Shape extends z.ZodRawShape>(
    name: string,
    shape: Shape,
    handler: (args: z.infer<z.ZodObject<Shape>>, context: NonNullable<ReturnType<typeof authorize>>) => Promise<unknown> | unknown,
  ) => {
    const spec = CONTROL_TOOLS.find((tool) => tool.name === name)!;
    if (!tools.has(name)) return;
    const callback = async (args: unknown) => {
      try {
        const context = authorize(runId, token);
        if (!context) throw new Error("This run can no longer use Slab control tools.");
        // The autonomy policy may have changed during the run (for example, a pause).
        if (!spec.enabled(context.agent.id)) throw new Error("This action is off at the current autonomy level.");
        return result(await handler(args as z.infer<z.ZodObject<Shape>>, context));
      } catch (error) {
        return result(error instanceof Error ? error.message : String(error), true);
      }
    };
    // The SDK infers the callback type from the schema; the generic wrapper cannot express it.
    server.registerTool(name, { description: spec.description, inputSchema: shape }, callback as never);
  };

  register(
    "ask_human",
    {
      question: z.string().trim().min(3).max(2_000),
      options: z.array(z.string().trim().min(1).max(60)).max(6).optional(),
      urgency: z.enum(["low", "normal", "high"]).optional(),
      wait_hours: z.number().min(1).max(720).optional(),
      default_answer: z.string().trim().max(1_000).optional(),
    },
    (args, { run, agent }) => {
      const request = createHumanRequest({
        kind: "question",
        runId: run.id,
        agentId: agent.id,
        question: args.question,
        options: args.options,
        urgency: args.urgency,
        defaultAnswer: args.default_answer ?? null,
        waitHours: args.wait_hours ?? null,
      });
      return `Question sent (id ${request.id}). End this run now with a short summary. Slab starts a new run with the answer${request.expiresAt ? `, or without one after ${request.expiresAt}` : ""}.`;
    },
  );
  register(
    "notify_human",
    { message: z.string().trim().min(3).max(3_000), urgency: z.enum(["low", "normal", "high"]).optional() },
    (args, { run, agent }) => {
      createHumanRequest({ kind: "update", runId: run.id, agentId: agent.id, question: args.message, urgency: args.urgency });
      return "Update sent.";
    },
  );
  register(
    "schedule_followup",
    {
      note: z.string().trim().min(3).max(4_000),
      in_hours: z.number().min(0.05).max(2_160).optional(),
      at: z.string().datetime({ offset: true }).optional(),
      issue_key: z.string().trim().max(64).optional(),
    },
    (args, { run, agent }) => {
      if (!args.in_hours && !args.at) throw new Error("Give in_hours or at.");
      const dueAt = args.at ? new Date(args.at) : new Date(Date.now() + args.in_hours! * 3_600_000);
      const followup = scheduleFollowup({ agentId: agent.id, runId: run.id, dueAt, note: args.note, issueKey: args.issue_key ?? run.issueKey });
      return { id: followup.id, dueAt: followup.dueAt };
    },
  );
  register("list_followups", {}, (_args, { agent }) =>
    listFollowups({ agentId: agent.id, status: "pending" }).map(({ id, dueAt, note, issueKey }) => ({ id, dueAt, note, issueKey })),
  );
  register("cancel_followup", { id: z.string().min(1) }, (args, { agent }) => {
    cancelFollowup(args.id, `agent:${agent.slug}`, agent.id);
    return "Cancelled.";
  });
  register("list_agents", {}, () =>
    agentRepository.listAgents().map(({ slug, name, role, enabled }) => ({ slug, name, role, enabled })),
  );
  register(
    "start_agent_run",
    { agent: z.string().trim().min(1), task: z.string().trim().min(3).max(20_000), issue_key: z.string().trim().max(64).optional() },
    (args, { run, agent }) => {
      const target = agentReference(args.agent);
      if (target.id === agent.id) throw new Error("Use schedule_followup to run yourself later.");
      assertCanDirect(agent, target);
      const started = startAutonomyRun({
        agentId: target.id,
        prompt: [`Task from ${agent.name}:`, "", args.task].join("\n"),
        issueKey: args.issue_key ?? null,
        parentRunId: run.id,
        origin: "delegate",
        title: `From ${agent.name}: ${args.task.slice(0, 80)}`,
        actor: `agent:${agent.slug}`,
      });
      return { runId: started.id, agent: target.slug };
    },
  );
  register(
    "start_coding_run",
    {
      issue_key: z.string().trim().min(3).max(64),
      repositories: z.array(z.string().trim().min(3).max(200)).max(5).optional(),
      note: z.string().trim().max(10_000).optional(),
    },
    async (args) => {
      const { startCodingRun } = await import("@/lib/coding/service");
      const repositories = codingRepository.listRepositories().filter((repository) => repository.enabled);
      let ids: string[];
      if (args.repositories?.length) {
        ids = args.repositories.map((name) => {
          const match = repositories.find((repository) => repository.fullName.toLowerCase() === name.toLowerCase());
          if (!match) throw new Error(`Repository ${name} is not configured. Configured: ${repositories.map((repository) => repository.fullName).join(", ")}`);
          return match.id;
        });
      } else {
        const project = args.issue_key.split("-")[0]!.toUpperCase();
        ids = repositories.filter((repository) => repository.workProjectKey === project).map(({ id }) => id);
        if (!ids.length)
          throw new Error(`No repository is linked to Work project ${project}. Pass repositories: ${repositories.map((repository) => repository.fullName).join(", ")}`);
      }
      const codeRun = await startCodingRun({ issueKey: args.issue_key, repositoryIds: ids, note: args.note });
      return { codingRun: codeRun.number, branch: codeRun.branch };
    },
  );
  register("list_automations", {}, () =>
    automationRepository.listAutomations().map((automation) => ({
      id: automation.id,
      name: automation.name,
      agentId: automation.agentId,
      trigger: automation.triggerType,
      cron: automation.cronExpression,
      timezone: automation.scheduleTimezone,
      enabled: automation.enabled,
    })),
  );
  const propose = (kind: ProposalKind, payload: unknown, context: NonNullable<ReturnType<typeof authorize>>) => {
    const proposal = proposeChange({ kind, agentId: context.agent.id, runId: context.run.id, payload });
    return proposal.status === "applied"
      ? { status: "applied", id: proposal.resultId, summary: proposal.summary }
      : proposal.status === "pending"
        ? { status: "waiting_for_human", proposalId: proposal.id, summary: proposal.summary }
        : { status: proposal.status, error: proposal.error, summary: proposal.summary };
  };
  register(
    "create_automation",
    {
      name: z.string().trim().min(2).max(120),
      agent: z.string().trim().min(1),
      cron: z.string().trim().min(9).max(120),
      timezone: z.string().trim().min(1).max(100),
      prompt: z.string().trim().min(2).max(20_000),
      mode: z.enum(["review", "task"]).default("task"),
    },
    (args, context) =>
      propose(
        "create_automation",
        { name: args.name, agentId: agentReference(args.agent).id, cronExpression: args.cron, scheduleTimezone: args.timezone, prompt: args.prompt, mode: args.mode },
        context,
      ),
  );
  register(
    "update_automation",
    {
      automation_id: z.string().min(1),
      name: z.string().trim().min(2).max(120).optional(),
      cron: z.string().trim().min(9).max(120).optional(),
      timezone: z.string().trim().min(1).max(100).optional(),
      prompt: z.string().trim().min(2).max(20_000).optional(),
      mode: z.enum(["review", "task"]).optional(),
    },
    (args, context) =>
      propose(
        "update_automation",
        { automationId: args.automation_id, name: args.name, cronExpression: args.cron, scheduleTimezone: args.timezone, prompt: args.prompt, mode: args.mode },
        context,
      ),
  );
  register("set_automation_enabled", { automation_id: z.string().min(1), enabled: z.boolean() }, (args, context) =>
    propose("set_automation_enabled", { automationId: args.automation_id, enabled: args.enabled }, context),
  );
  register(
    "create_agent",
    { name: z.string().trim().min(2).max(80), role: z.string().trim().min(2).max(500), instructions: z.string().trim().min(10).max(30_000) },
    (args, context) => propose("create_agent", args, context),
  );
  register(
    "update_agent_instructions",
    { agent: z.string().trim().min(1), instructions: z.string().trim().min(10).max(30_000), role: z.string().trim().min(2).max(500).optional() },
    (args, context) =>
      propose("update_agent_instructions", { agentId: agentReference(args.agent).id, instructions: args.instructions, role: args.role }, context),
  );

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export const AUTONOMY_AGENT_INSTRUCTIONS = [
  "Autonomy tools (server `slab`):",
  "- Ask the human only when a decision needs them (ask_human), then end the run; you continue in a new run with the answer.",
  "- Tell the human about results they must act on (notify_human): for example, a pull request ready for review and builds.",
  "- Schedule your own follow-ups instead of waiting (schedule_followup).",
  "- Changes to automations and agents may wait for the human; the tool result says whether they were applied.",
  "- Never try to change your permissions, integrations, budgets, or the autonomy level.",
].join("\n");
