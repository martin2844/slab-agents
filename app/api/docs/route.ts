import { z } from "zod";
import { apiError } from "@/lib/api";
import { DocsClient } from "@/lib/mcp/docs-client";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().default(""),
  parent_id: z.string().uuid().nullable().optional(),
  tags: z.array(z.string()).default([]),
  author: z.string().min(1).default("Martin"),
});
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams.get("q");
    return Response.json({
      data: q ? await DocsClient.search(q) : await DocsClient.list(),
    });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    return Response.json(
      { data: await DocsClient.create(schema.parse(await request.json())) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
