import { z } from "zod";
import { apiError } from "@/lib/api";
import {
  getRunDocsChanges,
  undoRunDocsChanges,
  reviewRunDocsChanges,
} from "@/lib/docs-run-changes";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    return Response.json({
      data: await getRunDocsChanges((await context.params).id),
    });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const input = z
      .object({
        action: z.enum(["undo", "merge", "reject"]).default("undo"),
        documentIds: z.array(z.string().uuid()).min(1).max(1000).optional(),
      })
      .strict()
      .parse(await request.json());
    return Response.json({
      data:
        input.action !== "undo"
          ? await reviewRunDocsChanges((await context.params).id, input.action)
          : await undoRunDocsChanges(
              (await context.params).id,
              input.documentIds,
            ),
    });
  } catch (error) {
    return apiError(error);
  }
}
