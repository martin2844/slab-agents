import { z } from "zod";
import { apiError } from "@/lib/api";
import { repository } from "@/lib/repository";
import { getPublicSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  workMcpUrl: z.url().optional(),
  workApiKey: z.string().optional(),
  docsMcpUrl: z.url().optional(),
  docsApiKey: z.string().optional(),
  runnerUrl: z
    .url()
    .refine((value) => {
      const hostname = new URL(value).hostname;
      return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname);
    }, "Runner must use a loopback URL")
    .optional(),
});

export async function GET() {
  return Response.json({ data: getPublicSettings() });
}
export async function PATCH(request: Request) {
  try {
    const input = schema.parse(await request.json());
    if (input.workMcpUrl)
      repository.setSetting("work_mcp_url", input.workMcpUrl);
    if (input.workApiKey)
      repository.setSetting("work_api_key", input.workApiKey);
    if (input.docsMcpUrl)
      repository.setSetting("docs_mcp_url", input.docsMcpUrl);
    if (input.docsApiKey)
      repository.setSetting("docs_api_key", input.docsApiKey);
    if (input.runnerUrl) repository.setSetting("runner_url", input.runnerUrl);
    return Response.json({ data: getPublicSettings() });
  } catch (error) {
    return apiError(error);
  }
}
