import { z } from "zod";
import { apiError } from "@/lib/api";
import { DocsClient } from "@/lib/mcp/docs-client";
import { getSetting } from "@/lib/settings";
const schema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  parent_id: z.string().uuid().nullable().optional(),
  tags: z.array(z.string()).optional(),
});
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/docs/[id]">,
) {
  try {
    const { id } = await ctx.params;
    const [document, revisions] = await Promise.all([
      DocsClient.get(id),
      DocsClient.revisions(id),
    ]);
    return Response.json({ data: { document, revisions } });
  } catch (error) {
    return apiError(error);
  }
}
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/docs/[id]">,
) {
  try {
    const { id } = await ctx.params;
    return Response.json({
      data: await DocsClient.update(id, {
        ...schema.parse(await request.json()),
        author: getSetting("operator_display_name"),
      }),
    });
  } catch (error) {
    return apiError(error);
  }
}
export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/docs/[id]">,
) {
  try {
    const { id } = await ctx.params;
    return Response.json({ data: await DocsClient.archive(id) });
  } catch (error) {
    return apiError(error);
  }
}
