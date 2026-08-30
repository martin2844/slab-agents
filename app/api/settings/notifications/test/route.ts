import { apiError } from "@/lib/api";
import { testOperatorNotifications } from "@/lib/operator-notification-service";

export const runtime = "nodejs";

export async function POST() {
  try {
    return Response.json({ data: await testOperatorNotifications() });
  } catch (error) {
    return apiError(error);
  }
}
