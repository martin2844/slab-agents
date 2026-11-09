import { apiError } from "@/lib/api";
import { startLinking } from "@/lib/telegram/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return Response.json({ data: startLinking() });
  } catch (error) {
    return apiError(error, "Could not create a link code.");
  }
}
