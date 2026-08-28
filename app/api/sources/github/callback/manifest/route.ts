import { publicRequestOrigin } from "@/lib/request-origin";
import { completeGithubManifest } from "@/lib/sources/github-app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const current = new URL(request.url);
  const redirect = new URL("/sources", publicRequestOrigin(request));
  try {
    const code = current.searchParams.get("code");
    const state = current.searchParams.get("state");
    if (!code || !state)
      throw new Error("GitHub did not return a registration code and state.");
    await completeGithubManifest(code, state);
    redirect.searchParams.set("github", "registered");
  } catch (error) {
    redirect.searchParams.set("github", "failed");
    redirect.searchParams.set(
      "message",
      error instanceof Error
        ? error.message.slice(0, 180)
        : "Registration failed",
    );
  }
  return Response.redirect(redirect);
}
