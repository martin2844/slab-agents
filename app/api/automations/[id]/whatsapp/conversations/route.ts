import { z } from "zod";
import { apiError, notFound } from "@/lib/api";
import { automationRepository } from "@/lib/repositories/automation-repository";
import { whatsappAutomationRepository } from "@/lib/repositories/whatsapp-automation-repository";
import { whatsappDirectChatSchema } from "@/lib/whatsapp-automation";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, ctx: Context) {
  try {
    const { id } = await ctx.params;
    if (automationRepository.getAutomation(id)?.triggerType !== "whatsapp")
      throw notFound("WhatsApp automation not found.");
    return Response.json({
      data: whatsappAutomationRepository.listConversations(id),
    });
  } catch (error) {
    return apiError(error);
  }
}
export async function PATCH(request: Request, ctx: Context) {
  try {
    const { id } = await ctx.params;
    const input = z
      .object({ chatId: whatsappDirectChatSchema, paused: z.boolean() })
      .strict()
      .parse(await request.json());
    whatsappAutomationRepository.setPaused(id, input.chatId, input.paused);
    return Response.json({
      data: whatsappAutomationRepository.listConversations(id),
    });
  } catch (error) {
    return apiError(error);
  }
}
