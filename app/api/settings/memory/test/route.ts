import { memoryModule } from "@/lib/memory/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const result = await memoryModule.check();
  return Response.json({ data: result });
}
