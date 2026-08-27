import { z } from "zod";
import { apiError } from "@/lib/api";
import { getUsageSummary } from "@/lib/usage-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const periodSchema = z.enum(["today", "7d", "30d", "month", "all"]);

export function GET(request: Request) {
  try {
    const period = periodSchema.parse(
      new URL(request.url).searchParams.get("period") ?? "today",
    );
    return Response.json(
      { data: getUsageSummary(period) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error, "Usage summary could not be loaded");
  }
}
