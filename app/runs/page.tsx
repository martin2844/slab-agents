import type { Metadata } from "next";
import { RunsView } from "@/components/runs-view";
import { getRunsPageData } from "@/lib/page-data";
export const metadata: Metadata = { title: "Runs" };
export const dynamic = "force-dynamic";
export default function RunsPage() {
  return <RunsView initialData={getRunsPageData()} />;
}
