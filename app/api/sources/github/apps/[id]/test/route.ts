import { apiError } from "@/lib/api";
import { verifyGithubApp } from "@/lib/sources/github-app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return Response.json({ data: await verifyGithubApp((await params).id) });
  } catch (error) {
    return apiError(error, "GitHub App verification failed.");
  }
}
