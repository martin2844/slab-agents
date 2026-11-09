import type { Metadata } from "next";
import { CodingSettings } from "@/components/coding/coding-settings";
import { codingRepository } from "@/lib/repositories/coding-repository";
import { agentRepository } from "@/lib/repositories/agent-repository";

export const metadata: Metadata = { title: "Coding settings" };
export const dynamic = "force-dynamic";

export default function CodingSettingsPage() {
  return (
    <CodingSettings
      initialRepositories={codingRepository.listRepositories()}
      agents={agentRepository.listAgents()}
    />
  );
}
