import type { Metadata } from "next";
import { IntegrationsView } from "@/components/integrations-view";
import { getIntegrationsPageData } from "@/lib/page-data";

export const metadata: Metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

export default function IntegrationsPage() {
  return <IntegrationsView initialData={getIntegrationsPageData()} />;
}
