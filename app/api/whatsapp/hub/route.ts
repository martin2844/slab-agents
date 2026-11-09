import { apiError } from "@/lib/api";
import { getWhatsAppHubData } from "@/lib/whatsapp-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ data: await getWhatsAppHubData() });
  } catch (error) {
    return apiError(error);
  }
}
