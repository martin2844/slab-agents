import { z } from "zod";
import { apiError } from "@/lib/api";
import { syncManagedProtonBridgeAddresses } from "@/lib/integrations/email-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ accountId: z.string().uuid() });

export async function POST(request: Request) {
  try {
    const { accountId } = schema.parse(await request.json());
    return Response.json({
      data: await syncManagedProtonBridgeAddresses(accountId),
    });
  } catch (error) {
    return apiError(error);
  }
}
