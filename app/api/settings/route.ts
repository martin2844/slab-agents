import { z } from "zod";
import { apiError } from "@/lib/api";
import {
  getPublicSettings,
  isAllowedRunnerUrl,
  setSetting,
} from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  workMcpUrl: z.url().optional(),
  workApiKey: z.string().optional(),
  docsMcpUrl: z.url().optional(),
  docsApiKey: z.string().optional(),
  runnerUrl: z
    .url()
    .refine(
      isAllowedRunnerUrl,
      "Runner host is not allowed by this installation",
    )
    .optional(),
  operatorDisplayName: z.string().trim().min(1).max(120).optional(),
  coordinationReviewer: z.string().trim().min(1).max(120).optional(),
});

export async function GET() {
  return Response.json({ data: getPublicSettings() });
}
export async function PATCH(request: Request) {
  try {
    const input = schema.parse(await request.json());
    if (input.workMcpUrl) setSetting("work_mcp_url", input.workMcpUrl);
    if (input.workApiKey) setSetting("work_api_key", input.workApiKey);
    if (input.docsMcpUrl) setSetting("docs_mcp_url", input.docsMcpUrl);
    if (input.docsApiKey) setSetting("docs_api_key", input.docsApiKey);
    if (input.runnerUrl) setSetting("runner_url", input.runnerUrl);
    if (input.operatorDisplayName)
      setSetting("operator_display_name", input.operatorDisplayName);
    if (input.coordinationReviewer)
      setSetting("coordination_reviewer", input.coordinationReviewer);
    return Response.json({ data: getPublicSettings() });
  } catch (error) {
    return apiError(error);
  }
}
