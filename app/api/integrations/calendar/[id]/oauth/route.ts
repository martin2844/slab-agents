import { integrationRepository } from "@/lib/repositories/integration-repository";
import { apiError, conflict, notFound } from "@/lib/api";
import { startCalendarOAuth } from "@/lib/integrations/calendar-service";
import { publicRequestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const integration = integrationRepository.getIntegrationRecord(id);
    if (!integration) {
      throw notFound("Calendar integration not found.");
    }
    const provider = integration.provider;
    const callbackPath =
      provider === "calendar_google"
        ? "/api/integrations/calendar/google/callback"
        : provider === "calendar_microsoft"
          ? "/api/integrations/calendar/microsoft/callback"
          : null;
    if (!callbackPath)
      throw conflict("This calendar provider does not use OAuth.");
    const redirectUri = new URL(
      callbackPath,
      publicRequestOrigin(request),
    ).toString();
    return Response.json({
      data: { authorizationUrl: startCalendarOAuth(id, redirectUri) },
    });
  } catch (error) {
    return apiError(error);
  }
}
