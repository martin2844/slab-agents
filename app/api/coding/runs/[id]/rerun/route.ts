import { z } from "zod";
import { apiError } from "@/lib/api";
import { rerunFrom } from "@/lib/coding/service";
import { PIPELINE_STAGES } from "@/lib/coding/stages";

// Publish only runs after the code review approval; it is never re-run directly.
const RERUNNABLE = PIPELINE_STAGES.filter((stage) => stage !== "publish") as [
  Exclude<(typeof PIPELINE_STAGES)[number], "publish">,
  ...Exclude<(typeof PIPELINE_STAGES)[number], "publish">[],
];

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ stage: z.enum(RERUNNABLE) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { stage } = schema.parse(await request.json());
    return Response.json({ data: await rerunFrom(id, stage) });
  } catch (error) {
    return apiError(error, "Could not re-run the stage.");
  }
}
