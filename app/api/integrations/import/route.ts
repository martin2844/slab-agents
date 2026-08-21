import { z } from "zod";
import { apiError } from "@/lib/api";
import { buildCustomHttpIntegrationDraft } from "@/lib/integrations/http-manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  source: z.string().trim().min(1).max(100_000),
});

export async function POST(request: Request) {
  try {
    const { source } = schema.parse(await request.json());
    try {
      return Response.json({ data: buildCustomHttpIntegrationDraft(source) });
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "The documentation could not be imported.",
        },
        { status: 400 },
      );
    }
  } catch (error) {
    return apiError(error);
  }
}
