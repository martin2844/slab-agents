import { z } from "zod";
import { apiError } from "@/lib/api";
import { isRuntimeId } from "@/lib/runtime-config";
import { updateRuntime } from "@/lib/runtime-service";

export const runtime = "nodejs";

const schema = z.object({
  enabled: z.boolean().optional(),
  apiKey: z.string().trim().min(16).max(16_384).optional(),
  defaultModel: z.string().trim().min(1).max(200).optional(),
});

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/runtimes/[id]">,
) {
  try {
    const { id } = await context.params;
    if (!isRuntimeId(id)) {
      return Response.json({ error: "Runtime not found" }, { status: 404 });
    }
    return Response.json({
      data: await updateRuntime({
        runtimeId: id,
        ...schema.parse(await request.json()),
      }),
    });
  } catch (error) {
    return apiError(error);
  }
}
