import { z } from "zod";
import { apiError } from "@/lib/api";
import { replyToStage } from "@/lib/coding/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ message: z.string().min(1).max(50_000) });

export async function POST(request: Request, context: { params: Promise<{ id: string; stageId: string }> }) {
  try {
    const { id, stageId } = await context.params;
    const { message } = schema.parse(await request.json());
    return Response.json({ data: await replyToStage(id, stageId, message) });
  } catch (error) {
    return apiError(error, "Could not send the message.");
  }
}
