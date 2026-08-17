import { apiError } from "@/lib/api";
import { WorkClient } from "@/lib/mcp/work-client";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return Response.json({ data: await WorkClient.listProjects() });
  } catch (error) {
    return apiError(error);
  }
}
