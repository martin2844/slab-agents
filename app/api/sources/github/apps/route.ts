import { apiError } from "@/lib/api";
import { githubAppCreateSchema } from "@/lib/api-schemas/source";
import { publicRequestOrigin } from "@/lib/request-origin";
import { sourceRepository } from "@/lib/repositories/source-repository";
import { createGithubAppManifest } from "@/lib/sources/github-app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    data: sourceRepository.listGithubApps().map((record) => {
      const app = { ...record };
      delete (app as Partial<typeof record>).privateKeyCiphertext;
      return app;
    }),
  });
}

export async function POST(request: Request) {
  try {
    const input = githubAppCreateSchema.parse(await request.json());
    return Response.json(
      {
        data: createGithubAppManifest({
          ...input,
          origin: publicRequestOrigin(request),
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error, "Could not begin GitHub App setup.");
  }
}
