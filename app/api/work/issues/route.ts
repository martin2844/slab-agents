import { z } from "zod";
import { apiError } from "@/lib/api";
import { WorkClient } from "@/lib/mcp/work-client";
import { tickWorkCoordination } from "@/lib/work-coordination";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const createSchema = z.object({
  project_key: z.string().min(1),
  title: z.string().min(2).max(500),
  description: z.string().optional(),
  type: z.enum(["epic", "story", "task", "bug"]).default("task"),
  priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  assignee: z.string().optional(),
  labels: z.array(z.string()).default([]),
});
export async function GET(request: Request) {
  try {
    const projectKey = new URL(request.url).searchParams.get("project");
    if (!projectKey) throw new Error("Project is required");
    return Response.json({ data: await WorkClient.listIssues(projectKey) });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    const issue = await WorkClient.createIssue(
      createSchema.parse(await request.json()),
    );
    void tickWorkCoordination();
    return Response.json({ data: issue }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
