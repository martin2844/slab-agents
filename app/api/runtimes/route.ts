import { listRuntimeCatalog } from "@/lib/runtime-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ data: await listRuntimeCatalog() });
}
