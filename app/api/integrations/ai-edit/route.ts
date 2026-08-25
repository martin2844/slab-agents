import { z } from "zod";
import { apiError } from "@/lib/api";
import { customHttpEditableDefinitionSchema } from "@/lib/api-schemas/integration";
import { proposeCustomHttpIntegrationEdit } from "@/lib/integrations/http-ai-edit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    current: customHttpEditableDefinitionSchema,
    instruction: z.string().trim().min(1).max(4_000),
    documentation: z.string().max(60_000).optional(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    return Response.json({
      data: await proposeCustomHttpIntegrationEdit(input),
    });
  } catch (error) {
    return apiError(error, "Could not generate an integration proposal");
  }
}
