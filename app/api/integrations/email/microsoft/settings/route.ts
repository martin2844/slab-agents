import { z } from "zod";
import { apiError } from "@/lib/api";
import {
  getEmailIntegrationState,
  saveMicrosoftOAuthSettings,
} from "@/lib/integrations/email-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  clientId: z.string().trim().min(1).max(512),
  clientSecret: z.string().trim().min(1).max(4096).optional(),
  tenant: z.string().trim().min(1).max(256).default("common"),
});

export async function GET() {
  return Response.json({ data: (await getEmailIntegrationState()).microsoftOAuth });
}

export async function PATCH(request: Request) {
  try {
    return Response.json({
      data: await saveMicrosoftOAuthSettings(schema.parse(await request.json())),
    });
  } catch (error) {
    return apiError(error);
  }
}
