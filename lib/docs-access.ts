import "server-only";

import { sourceRepository } from "@/lib/repositories/source-repository";

type DocsAccessTokenResponse = {
  data?: {
    token?: unknown;
    expiresAt?: unknown;
    features?: { runChanges?: unknown; draftChanges?: unknown };
  };
  error?: { message?: unknown } | null;
};

export type DocsSourceSnapshot = {
  collectionId: string;
  sourceId: string;
  name: string;
  accessVersion: number;
};

function accessTokenUrl(mcpUrl: string): string {
  const url = new URL(mcpUrl);
  url.pathname = "/api/access-tokens";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function issueDocsRunAccess(input: {
  runId: string;
  agentId: string;
  docsMcpUrl: string;
  adminApiKey: string;
  editingMode?: "auto" | "review";
  author?: string;
  fetcher?: typeof fetch;
}) {
  const sources = sourceRepository.listSourcesForAgent(input.agentId);
  const sourceSnapshot: DocsSourceSnapshot[] = sources.map((source) => ({
    collectionId: source.id,
    sourceId: source.id,
    name: source.name,
    accessVersion: source.accessVersion,
  }));
  const readCollectionIds = [
    "workspace",
    ...sourceSnapshot.map(({ collectionId }) => collectionId),
  ];
  const response = await (input.fetcher ?? fetch)(
    accessTokenUrl(input.docsMcpUrl),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.adminApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subject: `run:${input.runId}:agent:${input.agentId}`,
        runId: input.runId,
        ...(input.editingMode
          ? { editingMode: input.editingMode, author: input.author }
          : {}),
        readCollectionIds,
        writeCollectionIds: ["workspace"],
        ttlSeconds: 86_400,
      }),
      signal: AbortSignal.timeout(10_000),
      redirect: "manual",
    },
  );
  const payload = (await response
    .json()
    .catch(() => null)) as DocsAccessTokenResponse | null;
  const token = payload?.data?.token;
  const expiresAt = payload?.data?.expiresAt;
  if (
    !response.ok ||
    typeof token !== "string" ||
    typeof expiresAt !== "string"
  ) {
    const detail = payload?.error?.message;
    throw new Error(
      typeof detail === "string"
        ? `Docs run access could not be issued: ${detail}`
        : `Docs run access could not be issued (${response.status}).`,
    );
  }
  return {
    token,
    snapshot: {
      semantics: "snapshot_at_run_start" as const,
      workspaceCollectionId: "workspace",
      writeCollectionIds: ["workspace"],
      sources: sourceSnapshot,
      expiresAt,
      runChanges: payload?.data?.features?.runChanges === 1,
      draftChanges:
        !!input.editingMode && payload?.data?.features?.draftChanges === 1,
      editingMode: input.editingMode,
    },
  };
}
