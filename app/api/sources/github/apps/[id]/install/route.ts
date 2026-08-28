import { apiError } from "@/lib/api";
import { githubInstallUrl } from "@/lib/sources/github-app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return Response.json({
      data: { authorizationUrl: githubInstallUrl((await params).id) },
    });
  } catch (error) {
    return apiError(error, "Could not begin GitHub installation.");
  }
}
