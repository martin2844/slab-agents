import { z } from "zod";
import { apiError } from "@/lib/api";
import {
  getEmailIntegrationState,
  saveAndTestEmailIntegration,
} from "@/lib/integrations/email-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ serviceUrl: z.string().trim().url().max(2_048) });

export async function GET() {
  return Response.json({ data: await getEmailIntegrationState() });
}

export async function PATCH(request: Request) {
  try {
    const { serviceUrl } = schema.parse(await request.json());
    return Response.json({
      data: await saveAndTestEmailIntegration(serviceUrl),
    });
  } catch (error) {
    return apiError(error);
  }
}
