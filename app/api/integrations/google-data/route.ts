import { apiError } from "@/lib/api";
import { googleDataIntegrationSchema } from "@/lib/integrations/google-data-schema";
import {
  listGoogleDataIntegrations,
  saveGoogleDataIntegration,
} from "@/lib/integrations/google-data-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ data: listGoogleDataIntegrations() });
}

export async function POST(request: Request) {
  try {
    const input = googleDataIntegrationSchema.parse(await request.json());
    return Response.json(
      { data: await saveGoogleDataIntegration(input) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
