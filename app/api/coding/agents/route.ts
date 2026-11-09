import { z } from "zod";
import { apiError } from "@/lib/api";
import {
  ensureCodingAgents,
  getStageAgentOverrides,
  setStageAgentOverrides,
  stageAgentMapping,
} from "@/lib/coding/agents";
import { AGENT_STAGES } from "@/lib/coding/stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapping() {
  return stageAgentMapping().map(({ stage, reference, agent }) => ({
    stage,
    reference,
    agent: agent ? { id: agent.id, name: agent.name, slug: agent.slug, enabled: agent.enabled } : null,
  }));
}

export async function GET() {
  return Response.json({ data: mapping() });
}

/** Creates the default coding agents that are missing. */
export async function POST() {
  try {
    const created = ensureCodingAgents();
    return Response.json({ data: { created: created.length, mapping: mapping() } });
  } catch (error) {
    return apiError(error, "Could not create the coding agents.");
  }
}

const mappingSchema = z.partialRecord(z.enum(AGENT_STAGES as [string, ...string[]]), z.string().min(1).max(200));

export async function PUT(request: Request) {
  try {
    const input = mappingSchema.parse(await request.json());
    setStageAgentOverrides({ ...getStageAgentOverrides(), ...input });
    return Response.json({ data: mapping() });
  } catch (error) {
    return apiError(error, "Could not save the stage agents.");
  }
}
