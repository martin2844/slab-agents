import { z } from "zod";
import { apiError } from "@/lib/api";
import { setEmailAccountEnabled } from "@/lib/integrations/email-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ enabled: z.boolean() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { accountId } = await params;
    const { enabled } = schema.parse(await request.json());
    return Response.json({
      data: await setEmailAccountEnabled(accountId, enabled),
    });
  } catch (error) {
    return apiError(error);
  }
}
