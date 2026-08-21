import { z } from "zod";
import { apiError } from "@/lib/api";
import { continueManagedProtonBridge } from "@/lib/integrations/email-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  challengeId: z.string().uuid(),
  value: z.string().max(4096).refine((value) => !/[\r\n]/.test(value)).optional(),
});

export async function POST(request: Request) {
  try {
    return Response.json({
      data: await continueManagedProtonBridge(schema.parse(await request.json())),
    });
  } catch (error) {
    return apiError(error);
  }
}
