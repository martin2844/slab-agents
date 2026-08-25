import { agentRepository } from "@/lib/repositories/agent-repository";
import { conversationRepository } from "@/lib/repositories/conversation-repository";
import { z } from "zod";
import { apiError, conflict, notFound } from "@/lib/api";
import { getRuntimeConfig, runtimeIds } from "@/lib/runtime-config";
import { listRuntimeCatalog } from "@/lib/runtime-service";
import { createRunExecution, executeRunInBackground } from "@/lib/run-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  workSource: z.literal("slab").default("slab"),
  docsSource: z.literal("slab-docs").default("slab-docs"),
  agentId: z.string().uuid().optional(),
  prompt: z.string().min(10).max(50_000),
  title: z.string().min(1).max(100).default("First operating loop"),
  mode: z.enum(["review", "task"]).default("review"),
});

async function ensureCoo() {
  const current = agentRepository.getAgent("coo");
  if (current) return current;
  const runtime =
    (await listRuntimeCatalog()).find(
      (item) => item.enabled && item.registered && item.health === "available",
    )?.id ??
    runtimeIds.find((runtimeId) => getRuntimeConfig(runtimeId).enabled) ??
    "codex";
  return agentRepository.createAgent({
    name: "COO",
    slug: "coo",
    role: "Chief Operating Officer",
    instructions:
      "Use Work and Docs to identify priorities, blockers, owners, and concrete next actions. Be concise, evidence-based, and operational.",
    model: "default",
    runtime,
    enabled: true,
    fullAccess: false,
  });
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const agent = input.agentId
      ? agentRepository.getAgent(input.agentId)
      : await ensureCoo();
    if (!agent) throw notFound("Agent not found");
    if (!agent.enabled)
      throw conflict("This agent is disabled.", "AGENT_DISABLED");

    const thread = conversationRepository.createThread(agent.id, input.title);
    const run = createRunExecution({
      agentId: agent.id,
      threadId: thread.id,
      trigger: "manual",
      mode: input.mode,
      prompt: input.prompt,
    });
    void executeRunInBackground(run.id);

    return Response.json(
      {
        data: {
          agent,
          thread,
          run,
          href: `/agents/${agent.id}/threads/${thread.id}?run=${run.id}`,
        },
      },
      { status: 202 },
    );
  } catch (error) {
    return apiError(error);
  }
}
