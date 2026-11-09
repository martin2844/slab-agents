import { z } from "zod";
import { apiError } from "@/lib/api";
import { docsHistoryRequest, type DocsCommitDetail } from "@/lib/docs-history";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    return Response.json({
      data: await docsHistoryRequest<DocsCommitDetail>(`commits/${id}`),
    });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    z.object({ action: z.literal("revert") })
      .strict()
      .parse(await request.json());
    return Response.json({
      data: await docsHistoryRequest(`commits/${id}/revert`, "POST"),
    });
  } catch (error) {
    return apiError(error);
  }
}
