import { z } from "zod";
import { apiError } from "@/lib/api";
import {
  changeWhatsAppSession,
  getWhatsAppState,
  setWhatsAppAccess,
} from "@/lib/integrations/whatsapp";
import {
  getWhatsAppInstallation,
  installWhatsApp,
} from "@/lib/whatsapp-install-service";
import { integrationRepository } from "@/lib/repositories/integration-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };

export async function GET() {
  try {
    const host = await getWhatsAppInstallation();
    try {
      return Response.json(
        { data: { ...(await getWhatsAppState()), host, error: null } },
        { headers },
      );
    } catch {
      return Response.json(
        {
          data: {
            status: "UNAVAILABLE",
            account: null,
            qr: null,
            integration: integrationRepository.getIntegration("whatsapp"),
            host,
            error:
              "WhatsApp service is unavailable. Install it or check the host.",
          },
        },
        { headers },
      );
    }
  } catch (error) {
    return apiError(error);
  }
}
const actionSchema = z
  .object({ action: z.enum(["install", "connect", "restart", "unlink"]) })
  .strict();
export async function POST(request: Request) {
  try {
    const { action } = actionSchema.parse(await request.json());
    if (action === "install")
      return Response.json(
        { data: await installWhatsApp() },
        { status: 202, headers },
      );
    await changeWhatsAppSession(action);
    return Response.json({ data: { ok: true } }, { headers });
  } catch (error) {
    return apiError(error);
  }
}
const accessSchema = z
  .object({
    agentId: z.string().min(1).max(150),
    read: z.boolean(),
    write: z.enum(["disabled", "approval_required", "autonomous"]),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export async function PATCH(request: Request) {
  try {
    return Response.json(
      { data: setWhatsAppAccess(accessSchema.parse(await request.json())) },
      { headers },
    );
  } catch (error) {
    return apiError(error);
  }
}
