import type { Metadata } from "next";
import { AutomationsView } from "@/components/automations-view";
import { getAutomationsPageData } from "@/lib/page-data";
export const metadata: Metadata = { title: "Automations" };
export const dynamic = "force-dynamic";
export default async function AutomationsPage() {
  return <AutomationsView initialData={await getAutomationsPageData()} />;
}
