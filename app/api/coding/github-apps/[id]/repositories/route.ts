import { apiError } from "@/lib/api";
import { listGithubAppRepositories } from "@/lib/sources/github-app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json({ data: await listGithubAppRepositories(id) });
  } catch (error) {
    return apiError(error, "Could not list the repositories of this GitHub App.");
  }
}
