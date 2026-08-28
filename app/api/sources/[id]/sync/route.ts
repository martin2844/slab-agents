import { apiError } from "@/lib/api";
import { syncKnowledgeSource } from "@/lib/sources/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return Response.json({
      data: await syncKnowledgeSource((await params).id),
    });
  } catch (error) {
    return apiError(error, "Source synchronization failed.");
  }
}
