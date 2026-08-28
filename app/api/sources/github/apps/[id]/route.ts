import { apiError, conflict, notFound } from "@/lib/api";
import { sourceRepository } from "@/lib/repositories/source-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const id = (await params).id;
    const app = sourceRepository.getGithubApp(id);
    if (!app) throw notFound("GitHub App connection not found.");
    if (
      sourceRepository.listSources().some((source) => source.githubAppId === id)
    ) {
      throw conflict(
        "Remove sources using this GitHub App first.",
        "GITHUB_APP_IN_USE",
      );
    }
    if (!sourceRepository.deleteGithubApp(id))
      throw notFound("GitHub App connection not found.");
    return Response.json({ data: { id } });
  } catch (error) {
    return apiError(error, "Could not remove GitHub App connection.");
  }
}
