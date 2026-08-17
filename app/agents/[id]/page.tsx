import { AgentDetail } from "@/components/agent-detail";
import { getAgentDetailPageData } from "@/lib/page-data";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AgentPage({ params }: PageProps<"/agents/[id]">) {
  const { id } = await params;
  const data = getAgentDetailPageData(id);
  if (!data) notFound();
  return <AgentDetail data={data} />;
}
