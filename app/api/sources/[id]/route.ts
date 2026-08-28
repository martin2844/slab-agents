import { apiError } from "@/lib/api";
import {
  knowledgeSourceInputSchema,
  sourceDeleteSchema,
} from "@/lib/api-schemas/source";
import {
  deleteKnowledgeSource,
  getKnowledgeSource,
  saveKnowledgeSource,
} from "@/lib/sources/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    return Response.json({ data: getKnowledgeSource((await params).id) });
  } catch (error) {
    return apiError(error, "Could not load source.");
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const id = (await params).id;
    const input = knowledgeSourceInputSchema.parse({
      ...(await request.json()),
      id,
    });
    return Response.json({ data: saveKnowledgeSource(input) });
  } catch (error) {
    return apiError(error, "Could not update source.");
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const id = (await params).id;
    const input = sourceDeleteSchema.parse(await request.json());
    return Response.json({
      data: await deleteKnowledgeSource(
        id,
        input.expectedVersion,
        input.archiveDocuments,
      ),
    });
  } catch (error) {
    return apiError(error, "Could not delete source.");
  }
}
