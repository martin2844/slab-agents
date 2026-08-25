import { integrationRepository } from "@/lib/repositories/integration-repository";
import { apiError, badRequest } from "@/lib/api";
import {
  saveCustomHttpIntegration,
  saveCustomMcpIntegration,
  savePostHogIntegration,
} from "@/lib/integrations/service";
import {
  asIntegrationAuthType,
  integrationCreateSchema,
} from "@/lib/api-schemas/integration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ data: integrationRepository.listIntegrations() });
}

export async function POST(request: Request) {
  try {
    const input = integrationCreateSchema.parse(await request.json());
    if (input.provider === "posthog") {
      const apiKey = input.apiKey;
      if (!apiKey) throw badRequest("PostHog apiKey is required.");
      const integration = await savePostHogIntegration({
        apiKey,
        datacenter: input.datacenter,
        enabled: input.enabled,
        permissions: input.permissions,
      });
      return Response.json({ data: integration }, { status: 201 });
    } else if (input.provider === "custom_http") {
      const integration = await saveCustomHttpIntegration({
        name: input.name,
        baseUrl: input.baseUrl,
        authType: asIntegrationAuthType(input.authType) ?? "none",
        authHeaderName: input.authHeaderName,
        timeoutMs: input.timeoutMs,
        secret: input.secret,
        enabled: input.enabled,
        permissions: input.permissions,
        operations: input.operations,
      });
      return Response.json({ data: integration }, { status: 201 });
    }

    const integration = await saveCustomMcpIntegration({
      name: input.name,
      baseUrl: input.baseUrl,
      authType: asIntegrationAuthType(input.authType) ?? "none",
      authHeaderName: input.authHeaderName,
      timeoutMs: input.timeoutMs,
      secret: input.secret,
      enabled: input.enabled,
      permissions: input.permissions,
    });
    return Response.json({ data: integration }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
