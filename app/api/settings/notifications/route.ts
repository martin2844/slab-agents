import { z } from "zod";
import { apiError } from "@/lib/api";
import {
  getOperatorNotificationState,
  saveOperatorNotificationSettings,
} from "@/lib/operator-notification-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  enabled: z.boolean(),
  recipientEmail: z.email(),
  accountId: z.string().trim().min(1).nullable(),
});

export async function GET() {
  return Response.json({ data: getOperatorNotificationState() });
}

export async function PATCH(request: Request) {
  try {
    const input = schema.parse(await request.json());
    return Response.json({
      data: await saveOperatorNotificationSettings(input),
    });
  } catch (error) {
    return apiError(error);
  }
}
