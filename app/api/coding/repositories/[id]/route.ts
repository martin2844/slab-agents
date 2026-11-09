import { apiError } from "@/lib/api";
import { deleteCodeRepository, updateCodeRepository } from "@/lib/coding/service";
import { repositorySchema } from "@/lib/coding/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const input = repositorySchema.parse(await request.json());
    return Response.json({ data: updateCodeRepository(id, input) });
  } catch (error) {
    return apiError(error, "Could not update the repository.");
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    deleteCodeRepository(id);
    return Response.json({ data: { deleted: true } });
  } catch (error) {
    return apiError(error, "Could not delete the repository.");
  }
}
