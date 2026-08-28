import { apiError } from "@/lib/api";
import { knowledgeSourceInputSchema } from "@/lib/api-schemas/source";
import { getSourcesPageData, saveKnowledgeSource } from "@/lib/sources/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ data: getSourcesPageData() });
}

export async function POST(request: Request) {
  try {
    const input = knowledgeSourceInputSchema.parse(await request.json());
    return Response.json({ data: saveKnowledgeSource(input) }, { status: 201 });
  } catch (error) {
    return apiError(error, "Could not save source.");
  }
}
