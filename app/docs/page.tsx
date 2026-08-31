import type { Metadata } from "next";
import { DocsWorkspace } from "@/components/docs-workspace";
import { getDocsPageData } from "@/lib/page-data";
export const metadata: Metadata = { title: "Docs" };
export const dynamic = "force-dynamic";
export default async function DocsPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string }>;
}) {
  const { doc } = await searchParams;
  return <DocsWorkspace initialData={await getDocsPageData(doc)} />;
}
