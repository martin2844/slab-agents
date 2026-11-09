import type { Metadata } from "next";
import { AutonomyView } from "@/components/autonomy/autonomy-view";
import { getAutonomyOverview } from "@/lib/autonomy/overview";

export const metadata: Metadata = { title: "Autonomy" };
export const dynamic = "force-dynamic";

export default function AutonomyPage() {
  return <AutonomyView initialData={getAutonomyOverview()} />;
}
