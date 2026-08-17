import { apiError } from "@/lib/api";
import { retestPostHogIntegration } from "@/lib/integrations/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return Response.json({ data: await retestPostHogIntegration(id) });
  } catch (error) {
    return apiError(error);
  }
}
