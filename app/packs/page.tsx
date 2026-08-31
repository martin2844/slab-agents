import type { Metadata } from "next";
import { BlueprintsView } from "@/components/packs-view";
import { getOperatorPacksPageData } from "@/lib/page-data";

export const metadata: Metadata = { title: "Blueprints" };
export const dynamic = "force-dynamic";

export default async function PacksPage() {
  return <BlueprintsView initialData={await getOperatorPacksPageData()} />;
}
