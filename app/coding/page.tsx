import type { Metadata } from "next";
import { CodingRunsView } from "@/components/coding/coding-runs-view";
import { listCodingRuns } from "@/lib/coding/service";

export const metadata: Metadata = { title: "Coding" };
export const dynamic = "force-dynamic";

export default function CodingPage() {
  return <CodingRunsView initialRuns={listCodingRuns()} />;
}
