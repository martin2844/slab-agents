import { z } from "zod";
import { apiError } from "@/lib/api";
import { sendManualWhatsAppReply } from "@/lib/whatsapp-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    text: z.string().trim().min(1).max(4000),
    keepAutoReplies: z.boolean().default(false),
  })
  .strict();

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/whatsapp/hub/[chatId]/reply">,
) {
  try {
    const { chatId } = await ctx.params;
    const input = schema.parse(await request.json());
    return Response.json(
      {
        data: await sendManualWhatsAppReply({
          chatId: decodeURIComponent(chatId),
          ...input,
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error, "Could not send the WhatsApp reply.");
  }
}
