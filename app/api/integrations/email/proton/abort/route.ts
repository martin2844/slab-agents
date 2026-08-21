import { z } from "zod";
import { apiError } from "@/lib/api";
import { abortManagedProtonBridge } from "@/lib/integrations/email-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ challengeId: z.string().uuid() });

export async function POST(request: Request) {
  try {
    const { challengeId } = schema.parse(await request.json());
    return Response.json({ data: await abortManagedProtonBridge(challengeId) });
  } catch (error) {
    return apiError(error);
  }
}
