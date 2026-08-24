import type { Metadata } from "next";
import { AgentsView } from "@/components/agents-view";
import { repository } from "@/lib/repository";
import { listRuntimeCatalog } from "@/lib/runtime-service";
export const metadata: Metadata = { title: "Agents" };
export const dynamic = "force-dynamic";
export default async function AgentsPage() {
  return (
    <AgentsView
      initialAgents={repository.listAgents()}
      initialRuns={repository.listRuns()}
      integrations={repository.listIntegrations()}
      emailAssignments={repository.listAgentEmailAccess()}
      runtimes={await listRuntimeCatalog()}
    />
  );
}
