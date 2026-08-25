import { agentRepository } from "@/lib/repositories/agent-repository";
import { emailAccessRepository } from "@/lib/repositories/email-access-repository";
import { integrationRepository } from "@/lib/repositories/integration-repository";
import { runRepository } from "@/lib/repositories/run-repository";
import type { Metadata } from "next";
import { AgentsView } from "@/components/agents-view";
import { listRuntimeCatalog } from "@/lib/runtime-service";
export const metadata: Metadata = { title: "Agents" };
export const dynamic = "force-dynamic";
export default async function AgentsPage() {
  return (
    <AgentsView
      initialAgents={agentRepository.listAgents()}
      initialRuns={runRepository.listRuns()}
      integrations={integrationRepository.listIntegrations()}
      emailAssignments={emailAccessRepository.listAgentEmailAccess()}
      runtimes={await listRuntimeCatalog()}
    />
  );
}
