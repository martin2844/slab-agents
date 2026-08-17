import { z } from "zod";
import { apiError } from "@/lib/api";
import { runSetupCheck } from "@/lib/setup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  service: z.enum(["work", "docs", "runner", "codex"]).optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { service } = schema.parse(body);
    return Response.json({ data: await runSetupCheck(service) });
  } catch (error) {
    return apiError(error);
  }
}
