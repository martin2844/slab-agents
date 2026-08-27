import type { Metadata } from "next";
import { SystemUpdatesView } from "@/components/system-updates-view";
import { getSystemUpdatesData } from "@/lib/system-update-service";

export const metadata: Metadata = { title: "System" };
export const dynamic = "force-dynamic";

export default async function SystemPage() {
  return <SystemUpdatesView initialData={await getSystemUpdatesData()} />;
}
