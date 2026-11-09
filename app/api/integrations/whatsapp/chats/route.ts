import { z } from "zod";
import { apiError, conflict } from "@/lib/api";
import {
  getWhatsAppSession,
  wahaRequest,
  whatsappSession,
} from "@/lib/integrations/whatsapp";
import { integrationRepository } from "@/lib/repositories/integration-repository";
import { whatsappDirectChatSchema } from "@/lib/whatsapp-automation";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(10000)
      .parse(new URL(request.url).searchParams.get("offset") ?? 0);
    const session = await getWhatsAppSession();
    const integration =
      integrationRepository.getIntegrationRecordByProvider("whatsapp");
    if (
      !integration?.enabled ||
      session?.status !== "WORKING" ||
      session.me?.id !== integration.config.accountEmail
    )
      throw conflict("Connect WhatsApp before selecting contacts.");
    const rows = await wahaRequest(
      `/api/${whatsappSession}/chats?limit=50&offset=${offset}`,
    );
    const chats = (Array.isArray(rows) ? rows : []).flatMap((row: unknown) => {
      const result = z
        .object({
          id: whatsappDirectChatSchema,
          name: z.string().max(300).nullish(),
        })
        .safeParse(row);
      return result.success
        ? [
            {
              id: result.data.id,
              name: result.data.name || result.data.id.split("@")[0],
            },
          ]
        : [];
    });
    const latest =
      integrationRepository.getIntegrationRecordByProvider("whatsapp");
    if (!latest?.enabled || latest.version !== integration.version)
      throw conflict("WhatsApp connection changed. Reload contacts.");
    return Response.json({
      data: {
        account: session.me!.id,
        chats,
        nextOffset:
          Array.isArray(rows) && rows.length === 50 && offset < 10000
            ? offset + 50
            : null,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
