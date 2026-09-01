import { z } from "zod";

export const googleDataIntegrationSchema = z.object({
  id: z.string().uuid().optional(),
  expectedVersion: z.number().int().positive().optional(),
  provider: z.enum(["google_analytics", "google_search_console"]),
  name: z.string().trim().min(1).max(120),
  clientId: z.string().trim().max(1000).optional(),
  clientSecret: z.string().max(2000).optional(),
  enabled: z.boolean().optional(),
  permissions: z
    .record(z.string().uuid(), z.array(z.string().max(120)).max(20))
    .optional(),
});
