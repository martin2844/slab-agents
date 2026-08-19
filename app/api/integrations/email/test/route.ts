import { apiError } from "@/lib/api";
import { testEmailIntegration } from "@/lib/integrations/email-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return Response.json({ data: await testEmailIntegration() });
  } catch (error) {
    return apiError(error);
  }
}
