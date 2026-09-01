import { apiError } from "@/lib/api";
import { connectGmail } from "@/lib/integrations/email-service";
import { GOOGLE_OAUTH_CALLBACK_PATH } from "@/lib/integrations/google-oauth-contract";
import { publicRequestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const origin = publicRequestOrigin(request);
    const callback = `${origin}${GOOGLE_OAUTH_CALLBACK_PATH}`;
    return Response.json({ data: await connectGmail(callback) });
  } catch (error) {
    return apiError(error);
  }
}
