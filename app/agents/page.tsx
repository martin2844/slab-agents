import type { Metadata } from "next";
import { AgentsView } from "@/components/agents-view";
import { repository } from "@/lib/repository";
export const metadata: Metadata = { title: "Agents" };
export const dynamic = "force-dynamic";
export default function AgentsPage() {
  return (
    <AgentsView
      initialAgents={repository.listAgents()}
      initialQuickActions={repository.listAgentQuickActions()}
    />
  );
}
