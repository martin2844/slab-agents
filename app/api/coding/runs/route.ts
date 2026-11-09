import { z } from "zod";
import { apiError } from "@/lib/api";
import { listCodingRuns, listCodingRunsForIssue, startCodingRun } from "@/lib/coding/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const issue = new URL(request.url).searchParams.get("issue");
  return Response.json({ data: issue ? listCodingRunsForIssue(issue) : listCodingRuns() });
}

const startSchema = z.object({
  issueKey: z.string().min(1).max(64),
  repositoryId: z.string().min(1),
  note: z.string().max(10_000).optional(),
});

export async function POST(request: Request) {
  try {
    const input = startSchema.parse(await request.json());
    return Response.json({ data: await startCodingRun(input) }, { status: 201 });
  } catch (error) {
    return apiError(error, "Could not start the coding run.");
  }
}
