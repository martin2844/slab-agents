import { apiError } from "@/lib/api";
import { connectGmail } from "@/lib/integrations/email-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const origin = new URL(request.url).origin;
    const callback = `${origin}/api/integrations/email/google/callback`;
    return Response.json({ data: await connectGmail(callback) });
  } catch (error) {
    return apiError(error);
  }
}
