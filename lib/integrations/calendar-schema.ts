import { z } from "zod";

export const calendarInputSchema = z.object({
  id: z.string().uuid().optional(),
  provider: z.enum([
    "calendar_google",
    "calendar_microsoft",
    "calendar_caldav",
    "calendar_calcom",
    "calendar_ics",
  ]),
  name: z.string().trim().min(1).max(120),
  baseUrl: z.string().trim().max(2048).optional(),
  accountEmail: z.string().trim().email().max(320).optional(),
  accountName: z.string().trim().max(160).optional(),
  username: z.string().trim().max(320).optional(),
  password: z.string().max(1000).optional(),
  apiKey: z.string().max(2000).optional(),
  feedUrl: z.string().trim().max(4096).optional(),
  clientId: z.string().trim().max(1000).optional(),
  clientSecret: z.string().max(2000).optional(),
  tenant: z.string().trim().max(200).optional(),
  eventTypeId: z.number().int().positive().nullable().optional(),
  writePolicy: z
    .enum(["disabled", "approval_required", "autonomous"])
    .optional(),
  enabled: z.boolean().optional(),
  agentIds: z.array(z.string().uuid()).max(100).optional(),
});
