import { handleControlMcpRequest } from "@/lib/autonomy/control-mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const runId = new URL(request.url).searchParams.get("run") ?? "";
  return handleControlMcpRequest(request, runId);
}

export function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
