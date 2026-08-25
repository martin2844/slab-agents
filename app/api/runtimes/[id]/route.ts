import { z } from "zod";
import { apiError, notFound } from "@/lib/api";
import { isRuntimeId } from "@/lib/runtime-config";
import { updateRuntime } from "@/lib/runtime-service";

export const runtime = "nodejs";

const schema = z.object({
  enabled: z.boolean().optional(),
  apiKey: z.string().trim().min(16).max(16_384).optional(),
  defaultModel: z.string().trim().min(1).max(200).optional(),
  baseUrl: z.string().trim().url().max(2_048).optional(),
  apiFormat: z.enum(["responses", "chat_completions"]).optional(),
});

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/runtimes/[id]">,
) {
  try {
    const { id } = await context.params;
    if (!isRuntimeId(id)) {
      throw notFound("Runtime not found");
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
