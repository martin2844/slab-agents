import { AgentDetail } from "@/components/agent-detail";
import { getAgentDetailPageData } from "@/lib/page-data";
import { listRuntimeCatalog } from "@/lib/runtime-service";
import { getEmailIntegrationState } from "@/lib/integrations/email-service";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AgentPage({ params }: PageProps<"/agents/[id]">) {
  const { id } = await params;
  const data = getAgentDetailPageData(id);
  if (!data) notFound();
  const [runtimes, email] = await Promise.all([
    listRuntimeCatalog(),
    getEmailIntegrationState(),
  ]);
  return <AgentDetail data={{ ...data, runtimes, email }} />;
}
