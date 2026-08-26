import { z } from "zod";
import { apiError } from "@/lib/api";
import {
  getPublicSettings,
  isAllowedHonchoUrl,
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
  memoryProvider: z.enum(["disabled", "honcho"]).optional(),
  honchoUrl: z
    .url()
    .refine(
      (value) => isAllowedHonchoUrl(value),
      "Honcho URL must use HTTP or HTTPS without embedded credentials, query, or fragment",
    )
    .optional(),
  honchoApiKey: z.string().trim().max(1_024).optional(),
  honchoWorkspaceId: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9_.-]+$/)
    .optional(),
  memoryMaxContextTokens: z.number().int().min(200).max(4_000).optional(),
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
    if (input.memoryProvider)
      setSetting("memory_provider", input.memoryProvider);
    if (input.honchoUrl) setSetting("honcho_url", input.honchoUrl);
    if (input.honchoApiKey)
      setSetting("honcho_api_key", input.honchoApiKey);
    if (input.honchoWorkspaceId)
      setSetting("honcho_workspace_id", input.honchoWorkspaceId);
    if (input.memoryMaxContextTokens !== undefined)
      setSetting(
        "memory_max_context_tokens",
        String(input.memoryMaxContextTokens),
      );
    return Response.json({ data: getPublicSettings() });
  } catch (error) {
    return apiError(error);
  }
}
