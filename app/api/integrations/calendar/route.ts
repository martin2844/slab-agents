import { apiError } from "@/lib/api";
import { calendarInputSchema } from "@/lib/integrations/calendar-schema";
import {
  listCalendarIntegrations,
  saveCalendarIntegration,
} from "@/lib/integrations/calendar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ data: listCalendarIntegrations() });
}

export async function POST(request: Request) {
  try {
    const input = calendarInputSchema.parse(await request.json());
    return Response.json(
      { data: await saveCalendarIntegration(input) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
