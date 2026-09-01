import { apiError, notFound } from "@/lib/api";
import { googleDataIntegrationSchema } from "@/lib/integrations/google-data-schema";
import { saveGoogleDataIntegration } from "@/lib/integrations/google-data-service";
import { integrationRepository } from "@/lib/repositories/integration-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!integrationRepository.getIntegrationRecord(id)) {
      throw notFound("Google integration not found.");
    }
    const input = googleDataIntegrationSchema.parse(await request.json());
    return Response.json({
      data: await saveGoogleDataIntegration({ ...input, id }),
    });
  } catch (error) {
    return apiError(error);
  }
}
