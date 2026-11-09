import { apiError } from "@/lib/api";
import { getArtifact } from "@/lib/coding/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string; artifactId: string }> }) {
  try {
    const { id, artifactId } = await context.params;
    return Response.json({ data: getArtifact(id, artifactId) });
  } catch (error) {
    return apiError(error, "Could not read the file.");
  }
}
