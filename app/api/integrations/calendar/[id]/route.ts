import { apiError, notFound } from "@/lib/api";
import {
  deleteCalendarIntegration,
  saveCalendarIntegration,
} from "@/lib/integrations/calendar-service";
import { calendarInputSchema } from "@/lib/integrations/calendar-schema";
import { repository } from "@/lib/repository";
import { z } from "zod";

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
      throw notFound("Calendar integration not found.");
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
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const [{ id }, input] = await Promise.all([
      params,
      request
        .json()
        .then((body) =>
          z.object({ expectedVersion: z.number().int().positive() }).parse(body),
        ),
    ]);
    if (!deleteCalendarIntegration(id, input.expectedVersion)) {
      throw notFound("Calendar integration not found.");
    }
    return Response.json({ data: { deleted: true } });
  } catch (error) {
    return apiError(error);
  }
}
