import { z } from "zod";
import { apiError } from "@/lib/api";
import {
  saveCustomHttpIntegration,
  saveCustomMcpIntegration,
  savePostHogIntegration,
} from "@/lib/integrations/service";
import { repository } from "@/lib/repository";
import type { IntegrationAuthType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const permissionsSchema = z.record(
  z.string(),
  z.array(z.string().max(100)).max(20),
);
const parameterSchema = z.object({
  id: z.string().optional(),
  key: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(240).optional().default(""),
  method: z.enum(["GET", "HEAD"]).optional().default("GET"),
  path: z.string().trim().min(2).max(240),
  responsePath: z.string().trim().max(240).optional(),
  maxResponseBytes: z.coerce.number().int().positive().optional(),
  maxItems: z.coerce.number().int().positive().optional(),
  timeoutMs: z.coerce.number().int().positive().optional(),
  parameters: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        location: z.enum(["path", "query"]),
        type: z.enum(["string", "number", "integer", "boolean"]),
        required: z.boolean().optional().default(false),
        description: z.string().trim().max(240).optional(),
      }),
    )
    .max(20)
    .default([]),
});
const baseSchema = {
  permissions: permissionsSchema.default({}),
  enabled: z.boolean().optional(),
};
const posthogSchema = z.object({
  apiKey: z.string().trim().min(1).max(16_384).optional(),
  datacenter: z.enum(["us", "eu"]),
  ...baseSchema,
});
const customHttpSchema = z.object({
  name: z.string().trim().min(1).max(160),
  baseUrl: z.string().url(),
  authType: z.enum(["none", "bearer", "api_key_header"]).default("none"),
  authHeaderName: z.string().trim().max(80).optional(),
  secret: z.string().trim().max(16_384).optional(),
  timeoutMs: z.coerce.number().int().positive().optional(),
  operations: z.array(parameterSchema).min(1),
  ...baseSchema,
});
const customMcpSchema = z.object({
  name: z.string().trim().min(1).max(160),
  baseUrl: z.string().url(),
  authType: z.enum(["none", "bearer", "api_key_header"]).default("none"),
  authHeaderName: z.string().trim().max(80).optional(),
  secret: z.string().trim().max(16_384).optional(),
  timeoutMs: z.coerce.number().int().positive().optional(),
  ...baseSchema,
});

function asAuthType(value: unknown): IntegrationAuthType | undefined {
  if (value === "bearer" || value === "api_key_header" || value === "none") {
    return value;
  }
  return undefined;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const current = repository.getIntegrationRecord(id);
    if (!current) {
      throw new Error("Integration not found.");
    }
    let data;
    if (current.provider === "posthog") {
      const input = posthogSchema.parse(await request.json());
      data = await savePostHogIntegration({
        id,
        datacenter: input.datacenter,
        apiKey: input.apiKey,
        permissions: input.permissions,
        enabled: input.enabled,
      });
    } else if (current.provider === "custom_http") {
      const input = customHttpSchema.parse(await request.json());
      data = await saveCustomHttpIntegration({
        id,
        name: input.name,
        baseUrl: input.baseUrl,
        authType: asAuthType(input.authType) ?? "none",
        authHeaderName: input.authHeaderName,
        timeoutMs: input.timeoutMs,
        secret: input.secret,
        enabled: input.enabled,
        permissions: input.permissions,
        operations: input.operations,
      });
    } else if (current.provider === "custom_mcp") {
      const input = customMcpSchema.parse(await request.json());
      data = await saveCustomMcpIntegration({
        id,
        name: input.name,
        baseUrl: input.baseUrl,
        authType: asAuthType(input.authType) ?? "none",
        authHeaderName: input.authHeaderName,
        timeoutMs: input.timeoutMs,
        secret: input.secret,
        enabled: input.enabled,
        permissions: input.permissions,
      });
    } else {
      throw new Error("Integration type mismatch.");
    }
    return Response.json({ data });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const current = repository.getIntegration(id);
    if (!current) {
      return Response.json(
        { error: "Integration not found." },
        { status: 404 },
      );
    }
    const agentIds = Object.entries(current.permissions)
      .filter(([, tools]) => tools.length > 0)
      .map(([agentId]) => agentId);
    repository.deleteIntegration(id);
    return Response.json({ data: { id, agentIds } });
  } catch (error) {
    return apiError(error);
  }
}
