import { apiError } from "@/lib/api";
import { setWhatsAppChatArchived } from "@/lib/whatsapp-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = RouteContext<"/api/whatsapp/hub/[chatId]/archive">;

async function archive(ctx: Context, archived: boolean) {
  try {
    const { chatId } = await ctx.params;
    return Response.json({
      data: setWhatsAppChatArchived(decodeURIComponent(chatId), archived),
    });
  } catch (error) {
    return apiError(error, "Could not update the chat.");
  }
}

export async function POST(_request: Request, ctx: Context) {
  return archive(ctx, true);
}

export async function DELETE(_request: Request, ctx: Context) {
  return archive(ctx, false);
}
