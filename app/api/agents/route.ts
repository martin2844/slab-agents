import { agentRepository } from "@/lib/repositories/agent-repository";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { assertRuntimeSelectable } from "@/lib/runtime-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({
  name: z.string().min(2).max(80),
  role: z.string().min(2).max(120),
  instructions: z.string().min(10).max(20_000),
  runtime: z.string().min(1).max(64).default("codex"),
  model: z.string().min(1).default("default"),
  enabled: z.boolean().default(true),
  permissionMode: z
    .enum(["guarded", "full", "yolo", "custom"])
    .default("guarded"),
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
  return Response.json({ data: agentRepository.listAgents() });
}
export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    assertRuntimeSelectable(input.runtime, input.model);
    let slug = slugify(input.name),
      suffix = 2;
    while (agentRepository.getAgent(slug))
      slug = `${slugify(input.name)}-${suffix++}`;
    const permissionMode =
      input.permissionMode === "guarded" && input.fullAccess
        ? "full"
        : input.permissionMode;
    return Response.json(
      {
        data: agentRepository.createAgent({
          ...input,
          slug,
          permissionMode,
          fullAccess:
            permissionMode === "full" || permissionMode === "yolo",
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
