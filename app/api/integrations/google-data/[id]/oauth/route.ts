import { apiError, notFound } from "@/lib/api";
import { startGoogleDataOAuth } from "@/lib/integrations/google-data-service";
import { GOOGLE_OAUTH_CALLBACK_PATH } from "@/lib/integrations/google-oauth-contract";
import { integrationRepository } from "@/lib/repositories/integration-repository";
import { publicRequestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!integrationRepository.getIntegrationRecord(id)) {
      throw notFound("Google integration not found.");
    }
    const redirectUri = new URL(
      GOOGLE_OAUTH_CALLBACK_PATH,
      publicRequestOrigin(request),
    ).toString();
    return Response.json({
      data: { authorizationUrl: startGoogleDataOAuth(id, redirectUri) },
    });
  } catch (error) {
    return apiError(error);
  }
}
