import { apiError } from "@/lib/api";
import { DocsClient } from "@/lib/mcp/docs-client";
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/docs/[id]/revisions/[revision]">,
) {
  try {
    const { id, revision } = await ctx.params;
    return Response.json({
      data: await DocsClient.revision(id, Number(revision)),
    });
  } catch (error) {
    return apiError(error);
  }
}
