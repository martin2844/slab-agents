import { codeRunner, codeRunnerUrl } from "@/lib/coding/code-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const health = await codeRunner.health();
    return Response.json({ data: { reachable: true, url: codeRunnerUrl(), profile: health.profile ?? null } });
  } catch (error) {
    return Response.json({
      data: {
        reachable: false,
        url: codeRunnerUrl(),
        profile: null,
        error: error instanceof Error ? error.message : "The code runner is unavailable.",
      },
    });
  }
}
