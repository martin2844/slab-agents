import { apiError } from "@/lib/api";
import { testCalendarIntegration } from "@/lib/integrations/calendar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return Response.json({ data: await testCalendarIntegration(id) });
  } catch (error) {
    return apiError(error);
  }
}
