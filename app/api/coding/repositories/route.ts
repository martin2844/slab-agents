import { apiError } from "@/lib/api";
import { codingRepository } from "@/lib/repositories/coding-repository";
import { createCodeRepository } from "@/lib/coding/service";
import { repositorySchema } from "@/lib/coding/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ data: codingRepository.listRepositories() });
}

export async function POST(request: Request) {
  try {
    const input = repositorySchema.parse(await request.json());
    return Response.json({ data: createCodeRepository(input) }, { status: 201 });
  } catch (error) {
    return apiError(error, "Could not add the repository.");
  }
}
