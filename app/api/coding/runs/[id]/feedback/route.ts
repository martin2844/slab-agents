import { z } from "zod";
import { apiError } from "@/lib/api";
import { checkPullRequestFeedback, decideFeedback } from "@/lib/coding/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Read new PR feedback from GitHub and start a triage round. */
export async function POST(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return Response.json({ data: await checkPullRequestFeedback(id) });
  } catch (error) {
    return apiError(error, "Could not check the PR feedback.");
  }
}

const decisionsSchema = z.object({
  decisions: z
    .array(
      z.object({
        id: z.string().min(1),
        action: z.enum(["fix", "reply", "no_action"]).optional(),
        reply: z.string().max(10_000).nullable().optional(),
        reason: z.string().max(10_000).nullable().optional(),
        status: z.enum(["dismissed", "new", "triaged"]).optional(),
      }),
    )
    .max(500),
});

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { decisions } = decisionsSchema.parse(await request.json());
    return Response.json({ data: decideFeedback(id, decisions) });
  } catch (error) {
    return apiError(error, "Could not save the decisions.");
  }
}
