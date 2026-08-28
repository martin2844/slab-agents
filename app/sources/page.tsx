import type { Metadata } from "next";
import { SourcesView } from "@/components/sources-view";
import { getSourcesPageData } from "@/lib/sources/service";

export const metadata: Metadata = { title: "Sources" };
export const dynamic = "force-dynamic";

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const github = typeof query.github === "string" ? query.github : null;
  const message = typeof query.message === "string" ? query.message : null;
  return (
    <SourcesView
      initialData={getSourcesPageData()}
      notice={
        github
          ? {
              type: github === "failed" ? "error" : "success",
              message:
                github === "registered"
                  ? "GitHub App registered. Install repository access to continue."
                  : github === "connected"
                    ? "GitHub repository access connected."
                    : message || "GitHub setup failed.",
            }
          : null
      }
    />
  );
}
