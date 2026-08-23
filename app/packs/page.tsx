import type { Metadata } from "next";
import { PacksView } from "@/components/packs-view";
import { getOperatorPacksPageData } from "@/lib/page-data";

export const metadata: Metadata = { title: "Operator Packs" };
export const dynamic = "force-dynamic";

export default async function PacksPage() {
  return <PacksView initialData={await getOperatorPacksPageData()} />;
}
