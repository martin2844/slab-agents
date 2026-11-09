import { apiError } from "@/lib/api";
import { getWhatsAppNavState } from "@/lib/whatsapp-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ data: getWhatsAppNavState() });
  } catch (error) {
    return apiError(error);
  }
}
