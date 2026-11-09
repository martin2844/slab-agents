import { z } from "zod";
import { apiError } from "@/lib/api";
import { sendChatMessage } from "@/lib/coding/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ message: z.string().min(1).max(50_000) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { message } = schema.parse(await request.json());
    return Response.json({ data: sendChatMessage(id, message) }, { status: 202 });
  } catch (error) {
    return apiError(error, "Could not send the message.");
  }
}
