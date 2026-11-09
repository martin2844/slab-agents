import { apiError } from "@/lib/api";
import { getWhatsAppHubMessages } from "@/lib/whatsapp-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/whatsapp/hub/[chatId]/messages">,
) {
  try {
    const { chatId } = await ctx.params;
    return Response.json({
      data: await getWhatsAppHubMessages(decodeURIComponent(chatId)),
    });
  } catch (error) {
    return apiError(error);
  }
}
