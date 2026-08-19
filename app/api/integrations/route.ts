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
const basePermissionSchema = permissionsSchema.default({});
const baseInput = {
  permissions: basePermissionSchema,
  enabled: z.boolean().optional(),
};
const posthogInput = z.object({
  provider: z.literal("posthog"),
  apiKey: z.string().trim().min(1).max(16_384).optional(),
  datacenter: z.enum(["us", "eu"]),
  ...baseInput,
});
const customHttpInput = z.object({
  provider: z.literal("custom_http"),
  name: z.string().trim().min(1).max(160),
  baseUrl: z.string().url(),
  authType: z.enum(["none", "bearer", "api_key_header"]).default("none"),
  authHeaderName: z.string().trim().max(80).optional(),
  secret: z.string().trim().max(16_384).optional(),
  timeoutMs: z.coerce.number().int().positive().optional(),
  enabled: z.boolean().optional(),
  permissions: baseInput.permissions,
  operations: z.array(parameterSchema).min(1),
});
const customMcpInput = z.object({
  provider: z.literal("custom_mcp"),
  name: z.string().trim().min(1).max(160),
  baseUrl: z.string().url(),
  authType: z.enum(["none", "bearer", "api_key_header"]).default("none"),
  authHeaderName: z.string().trim().max(80).optional(),
  secret: z.string().trim().max(16_384).optional(),
  timeoutMs: z.coerce.number().int().positive().optional(),
  enabled: z.boolean().optional(),
  permissions: baseInput.permissions,
});
const schema = z.discriminatedUnion("provider", [
  posthogInput,
  customHttpInput,
  customMcpInput,
]);

function asAuthType(value: unknown): IntegrationAuthType | undefined {
  if (value === "bearer" || value === "api_key_header" || value === "none") {
    return value;
  }
  return undefined;
}

export async function GET() {
  return Response.json({ data: repository.listIntegrations() });
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    if (input.provider === "posthog") {
      const apiKey = input.apiKey;
      if (!apiKey) throw new Error("PostHog apiKey is required.");
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
        authType: asAuthType(input.authType) ?? "none",
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
      authType: asAuthType(input.authType) ?? "none",
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
