import { z } from "zod";

import { apiError } from "@/lib/api";
import { setCalendarIntegrationEnabled } from "@/lib/integrations/calendar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const [{ id }, input] = await Promise.all([
      params,
      request
        .json()
        .then((body) => z.object({ enabled: z.boolean() }).parse(body)),
    ]);
    return Response.json({
      data: setCalendarIntegrationEnabled(id, input.enabled),
    });
  } catch (error) {
    return apiError(error);
  }
}
