import { z } from "zod";
import { apiError } from "@/lib/api";
import { savePostHogIntegration } from "@/lib/integrations/service";
import { repository } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  apiKey: z.string().trim().min(1).max(16_384).optional(),
  datacenter: z.enum(["us", "eu"]),
  permissions: z
    .record(z.string(), z.array(z.string().max(100)).max(20))
    .default({}),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const current = repository.getIntegrationRecord(id);
    if (!current || current.provider !== "posthog") {
      throw new Error("Integration not found.");
    }
    return Response.json({
      data: await savePostHogIntegration({
        id,
        ...schema.parse(await request.json()),
      }),
    });
  } catch (error) {
    return apiError(error);
  }
}
