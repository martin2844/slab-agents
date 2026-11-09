import { z } from "zod";
import { apiError } from "@/lib/api";
import { decideProposal } from "@/lib/autonomy/proposals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { decision } = z.object({ decision: z.enum(["approve", "reject"]) }).parse(await request.json());
    return Response.json({ data: decideProposal(id, decision, "operator") });
  } catch (error) {
    return apiError(error, "Could not decide the proposal.");
  }
}
