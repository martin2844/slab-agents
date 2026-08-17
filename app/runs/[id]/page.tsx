import { RunDetail } from "@/components/run-detail";
import { getRunDetailPageData } from "@/lib/page-data";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: PageProps<"/runs/[id]">) {
  const { id } = await params;
  const data = getRunDetailPageData(id);
  if (!data) notFound();
  return <RunDetail data={data} />;
}
