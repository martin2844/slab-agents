import { z } from "zod";
import { apiError } from "@/lib/api";
import { runSetupCheck } from "@/lib/setup";

export const runtime = "nodejs";
const schema = z.object({
  service: z.enum(["work", "docs", "runner", "codex"]),
});
export async function POST(request: Request) {
  try {
    const { service } = schema.parse(await request.json());
    return Response.json({ data: await runSetupCheck(service) });
  } catch (error) {
    return apiError(error);
  }
}
