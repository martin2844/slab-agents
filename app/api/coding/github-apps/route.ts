import { sourceRepository } from "@/lib/repositories/source-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    data: sourceRepository.listGithubApps().map((app) => ({
      id: app.id,
      name: app.name,
      accountLogin: app.accountLogin,
      status: app.status,
      installed: Boolean(app.installationId),
    })),
  });
}
