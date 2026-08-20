import { z } from "zod";
import { apiError } from "@/lib/api";
import {
  getEmailIntegrationState,
  saveGoogleOAuthSettings,
} from "@/lib/integrations/email-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  clientId: z.string().trim().min(1).max(512),
  clientSecret: z.string().trim().min(1).max(4096).optional(),
});

export async function GET() {
  return Response.json({ data: (await getEmailIntegrationState()).gmailOAuth });
}

export async function PATCH(request: Request) {
  try {
    const input = schema.parse(await request.json());
    return Response.json({ data: await saveGoogleOAuthSettings(input) });
  } catch (error) {
    return apiError(error);
  }
}
