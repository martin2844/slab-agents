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
  /** First repository is the primary one. `repositoryId` is the single-repository form. */
  repositoryIds: z.array(z.string().min(1)).min(1).max(5).optional(),
  repositoryId: z.string().min(1).optional(),
  note: z.string().max(10_000).optional(),
});

export async function POST(request: Request) {
  try {
    const { repositoryIds, repositoryId, issueKey, note } = startSchema.parse(await request.json());
    const ids = repositoryIds ?? (repositoryId ? [repositoryId] : []);
    return Response.json({ data: await startCodingRun({ issueKey, note, repositoryIds: ids }) }, { status: 201 });
  } catch (error) {
    return apiError(error, "Could not start the coding run.");
  }
}
