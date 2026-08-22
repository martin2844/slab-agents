import { apiError } from "@/lib/api";
import {
  deleteCalendarIntegration,
  saveCalendarIntegration,
} from "@/lib/integrations/calendar-service";
import { calendarInputSchema } from "@/lib/integrations/calendar-schema";
import { repository } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const current = repository.getIntegration(id);
    if (!current) {
      return Response.json(
        { error: "Calendar integration not found." },
        { status: 404 },
      );
    }
    const body = await request.json();
    const input = calendarInputSchema.parse({
      ...body,
      id,
      provider: current.provider,
      name: body.name ?? current.name,
    });
    return Response.json({ data: await saveCalendarIntegration(input) });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!deleteCalendarIntegration(id)) {
      return Response.json(
        { error: "Calendar integration not found." },
        { status: 404 },
      );
    }
    return Response.json({ data: { deleted: true } });
  } catch (error) {
    return apiError(error);
  }
}
