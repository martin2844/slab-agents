import { z } from "zod";
import type { IntegrationAuthType } from "@/lib/types";

export const integrationPermissionsSchema = z.record(
  z.string(),
  z.array(z.string().max(100)).max(20),
);

export const integrationOperationSchema = z.object({
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
  permissions: integrationPermissionsSchema.default({}),
  enabled: z.boolean().optional(),
};
const expectedVersionSchema = z.number().int().positive();

export const posthogIntegrationSchema = z.object({
  apiKey: z.string().trim().min(1).max(16_384).optional(),
  datacenter: z.enum(["us", "eu"]),
  ...baseSchema,
});

export const customHttpIntegrationSchema = z.object({
  name: z.string().trim().min(1).max(160),
  baseUrl: z.string().url(),
  authType: z.enum(["none", "bearer", "api_key_header"]).default("none"),
  authHeaderName: z.string().trim().max(80).optional(),
  secret: z.string().trim().max(16_384).optional(),
  timeoutMs: z.coerce.number().int().positive().optional(),
  operations: z.array(integrationOperationSchema).min(1),
  ...baseSchema,
});

export const customMcpIntegrationSchema = z.object({
  name: z.string().trim().min(1).max(160),
  baseUrl: z.string().url(),
  authType: z.enum(["none", "bearer", "api_key_header"]).default("none"),
  authHeaderName: z.string().trim().max(80).optional(),
  secret: z.string().trim().max(16_384).optional(),
  timeoutMs: z.coerce.number().int().positive().optional(),
  ...baseSchema,
});

export const posthogIntegrationUpdateSchema = posthogIntegrationSchema.extend({
  expectedVersion: expectedVersionSchema,
});
export const customHttpIntegrationUpdateSchema =
  customHttpIntegrationSchema.extend({ expectedVersion: expectedVersionSchema });
export const customMcpIntegrationUpdateSchema = customMcpIntegrationSchema.extend(
  { expectedVersion: expectedVersionSchema },
);

export const integrationCreateSchema = z.discriminatedUnion("provider", [
  posthogIntegrationSchema.extend({ provider: z.literal("posthog") }),
  customHttpIntegrationSchema.extend({ provider: z.literal("custom_http") }),
  customMcpIntegrationSchema.extend({ provider: z.literal("custom_mcp") }),
]);

export function asIntegrationAuthType(
  value: unknown,
): IntegrationAuthType | undefined {
  return value === "bearer" || value === "api_key_header" || value === "none"
    ? value
    : undefined;
}
