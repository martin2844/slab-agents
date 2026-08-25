import { integrationRepository } from "@/lib/repositories/integration-repository";
import { apiError, badRequest, notFound } from "@/lib/api";
import {
  saveCustomHttpIntegration,
  saveCustomMcpIntegration,
  savePostHogIntegration,
} from "@/lib/integrations/service";
import {
  asIntegrationAuthType,
  customHttpIntegrationUpdateSchema,
  customMcpIntegrationUpdateSchema,
  posthogIntegrationUpdateSchema,
} from "@/lib/api-schemas/integration";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const current = integrationRepository.getIntegrationRecord(id);
    if (!current) {
      throw notFound("Integration not found.");
    }
    let data;
    if (current.provider === "posthog") {
      const input = posthogIntegrationUpdateSchema.parse(await request.json());
      data = await savePostHogIntegration({
        id,
        datacenter: input.datacenter,
        apiKey: input.apiKey,
        permissions: input.permissions,
        enabled: input.enabled,
        expectedVersion: input.expectedVersion,
      });
    } else if (current.provider === "custom_http") {
      const input = customHttpIntegrationUpdateSchema.parse(
        await request.json(),
      );
      data = await saveCustomHttpIntegration({
        id,
        name: input.name,
        baseUrl: input.baseUrl,
        authType: asIntegrationAuthType(input.authType) ?? "none",
        authHeaderName: input.authHeaderName,
        timeoutMs: input.timeoutMs,
        secret: input.secret,
        enabled: input.enabled,
        permissions: input.permissions,
        operations: input.operations,
        expectedVersion: input.expectedVersion,
      });
    } else if (current.provider === "custom_mcp") {
      const input = customMcpIntegrationUpdateSchema.parse(
        await request.json(),
      );
      data = await saveCustomMcpIntegration({
        id,
        name: input.name,
        baseUrl: input.baseUrl,
        authType: asIntegrationAuthType(input.authType) ?? "none",
        authHeaderName: input.authHeaderName,
        timeoutMs: input.timeoutMs,
        secret: input.secret,
        enabled: input.enabled,
        permissions: input.permissions,
        expectedVersion: input.expectedVersion,
      });
    } else {
      throw badRequest("Integration type mismatch.");
    }
    return Response.json({ data });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const [{ id }, input] = await Promise.all([
      params,
      request
        .json()
        .then((body) =>
          z
            .object({ expectedVersion: z.number().int().positive() })
            .parse(body),
        ),
    ]);
    const current = integrationRepository.getIntegration(id);
    if (!current) {
      throw notFound("Integration not found.");
    }
    const agentIds = Object.entries(current.permissions)
      .filter(([, tools]) => tools.length > 0)
      .map(([agentId]) => agentId);
    integrationRepository.deleteIntegration(id, input.expectedVersion);
    return Response.json({ data: { id, agentIds } });
  } catch (error) {
    return apiError(error);
  }
}
