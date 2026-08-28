import { apiError } from "@/lib/api";
import { listGithubAppRepositories } from "@/lib/sources/github-app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return Response.json({
      data: await listGithubAppRepositories((await params).id),
    });
  } catch (error) {
    return apiError(error, "Could not list GitHub repositories.");
  }
}
