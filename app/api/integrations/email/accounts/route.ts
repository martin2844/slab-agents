import { z } from "zod";
import { apiError } from "@/lib/api";
import {
  createEmailAccount,
  getEmailIntegrationState,
} from "@/lib/integrations/email-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tlsMode = z.enum(["ssl", "starttls", "none"]);
const imapSchema = z.object({
  provider: z.enum(["proton-bridge", "imap-smtp"]),
  emailAddress: z.string().trim().email(),
  displayName: z.string().trim().min(1).max(200),
  imapHost: z.string().trim().min(1).max(500),
  imapPort: z.coerce.number().int().min(1).max(65_535),
  imapTlsMode: tlsMode,
  smtpHost: z.string().trim().min(1).max(500),
  smtpPort: z.coerce.number().int().min(1).max(65_535),
  smtpTlsMode: tlsMode,
  username: z.string().trim().min(1).max(500),
  password: z.string().min(1).max(16_384),
});

const apiProviderSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("agentmail"),
    emailAddress: z.string().trim().email(),
    displayName: z.string().trim().min(1).max(200),
    inboxId: z.string().trim().min(1).max(320),
    apiKey: z.string().trim().min(1).max(4096),
    baseUrl: z.string().trim().url().optional(),
  }),
  z.object({
    provider: z.literal("resend"),
    emailAddress: z.string().trim().email(),
    displayName: z.string().trim().min(1).max(200),
    apiKey: z.string().trim().min(1).max(4096),
    inboundEnabled: z.boolean().optional(),
    baseUrl: z.string().trim().url().optional(),
  }),
]);
const schema = z.union([imapSchema, apiProviderSchema]);

export async function GET() {
  return Response.json({ data: (await getEmailIntegrationState()).accounts });
}

export async function POST(request: Request) {
  try {
    const { provider, ...input } = schema.parse(await request.json());
    return Response.json(
      { data: await createEmailAccount(provider, input) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
