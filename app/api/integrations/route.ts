import { z } from "zod";
import { apiError } from "@/lib/api";
import { savePostHogIntegration } from "@/lib/integrations/service";
import { repository } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const permissionsSchema = z.record(
  z.string(),
  z.array(z.string().max(100)).max(20),
);
const schema = z.object({
  provider: z.literal("posthog"),
  apiKey: z.string().trim().min(1).max(16_384).optional(),
  datacenter: z.enum(["us", "eu"]),
  permissions: permissionsSchema.default({}),
});

export async function GET() {
  return Response.json({ data: repository.listIntegrations() });
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const integration = await savePostHogIntegration(input);
    return Response.json({ data: integration }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
