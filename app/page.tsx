import { OverviewDashboard } from "@/components/overview-dashboard";
import { getOverviewPageData } from "@/lib/page-data";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  return <OverviewDashboard data={await getOverviewPageData()} />;
}
