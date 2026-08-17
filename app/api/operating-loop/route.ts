import { z } from "zod";
import { apiError } from "@/lib/api";
import { repository } from "@/lib/repository";
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

function ensureCoo() {
  const current = repository.getAgent("coo");
  if (current) return current;
  return repository.createAgent({
    name: "COO",
    slug: "coo",
    role: "Chief Operating Officer",
    instructions:
      "Use Work and Docs to identify priorities, blockers, owners, and concrete next actions. Be concise, evidence-based, and operational.",
    model: "default",
    enabled: true,
    fullAccess: false,
  });
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const agent = input.agentId
      ? repository.getAgent(input.agentId)
      : ensureCoo();
    if (!agent) throw new Error("Agent not found");
    if (!agent.enabled) throw new Error("This agent is disabled.");

    const thread = repository.createThread(agent.id, input.title);
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
