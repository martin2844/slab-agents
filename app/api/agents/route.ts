import { z } from "zod";
import { apiError } from "@/lib/api";
import { repository } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({
  name: z.string().min(2).max(80),
  role: z.string().min(2).max(120),
  instructions: z.string().min(10).max(20_000),
  model: z.string().min(1).default("default"),
  enabled: z.boolean().default(true),
  fullAccess: z.boolean().default(false),
});
const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
export async function GET() {
  return Response.json({ data: repository.listAgents() });
}
export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    let slug = slugify(input.name),
      suffix = 2;
    while (repository.getAgent(slug))
      slug = `${slugify(input.name)}-${suffix++}`;
    return Response.json(
      { data: repository.createAgent({ ...input, slug }) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
