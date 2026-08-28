import { publicRequestOrigin } from "@/lib/request-origin";
import { completeGithubInstallation } from "@/lib/sources/github-app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const current = new URL(request.url);
  const redirect = new URL("/sources", publicRequestOrigin(request));
  try {
    const installationId = current.searchParams.get("installation_id");
    const state = current.searchParams.get("state");
    if (!installationId || !state)
      throw new Error("GitHub did not return an installation and state.");
    await completeGithubInstallation(installationId, state);
    redirect.searchParams.set("github", "connected");
  } catch (error) {
    redirect.searchParams.set("github", "failed");
    redirect.searchParams.set(
      "message",
      error instanceof Error
        ? error.message.slice(0, 180)
        : "Installation failed",
    );
  }
  return Response.redirect(redirect);
}
