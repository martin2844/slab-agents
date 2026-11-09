import { z } from "zod";
import { apiError } from "@/lib/api";
import { answerHumanRequest } from "@/lib/autonomy/human-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { answer } = z.object({ answer: z.string().min(1).max(4_000) }).parse(await request.json());
    return Response.json({ data: answerHumanRequest(id, answer, "operator") });
  } catch (error) {
    return apiError(error, "Could not answer the question.");
  }
}
