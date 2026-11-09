import { apiError } from "@/lib/api";
import { receiveWhatsAppWebhook } from "@/lib/whatsapp-webhook";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    return Response.json(await receiveWhatsAppWebhook(request));
  } catch (error) {
    return apiError(error);
  }
}
