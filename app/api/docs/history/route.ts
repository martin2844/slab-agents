import { z } from "zod";
import { apiError } from "@/lib/api";
import {
  docsHistoryRequest,
  type DocsCommit,
  type DocsProposal,
} from "@/lib/docs-history";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const documentId = z
      .string()
      .uuid()
      .optional()
      .parse(params.get("documentId") ?? undefined);
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .parse(params.get("offset") ?? 0);
    const query = new URLSearchParams({
      offset: String(offset),
      ...(documentId ? { documentId } : {}),
    });
    const [commits, proposals] = await Promise.all([
      docsHistoryRequest<DocsCommit[]>(`commits?${query}`),
      docsHistoryRequest<DocsProposal[]>("proposals"),
    ]);
    return Response.json({ data: { commits, proposals } });
  } catch (error) {
    return apiError(error);
  }
}
