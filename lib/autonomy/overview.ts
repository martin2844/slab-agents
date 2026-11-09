import "server-only";

import { agentRepository } from "@/lib/repositories/agent-repository";
import { getAutonomyPolicy, listAutonomyEvents } from "@/lib/autonomy/service";
import { listHumanRequests } from "@/lib/autonomy/human-requests";
import { listProposals } from "@/lib/autonomy/proposals";
import { listFollowups } from "@/lib/autonomy/followups";
import { getTelegramStatus } from "@/lib/telegram/service";

export function getAutonomyOverview() {
  return {
    policy: getAutonomyPolicy(),
    telegram: getTelegramStatus(),
    agents: agentRepository
      .listAgents()
      .map(({ id, name, slug, role, enabled }) => ({ id, name, slug, role, enabled })),
    questions: listHumanRequests({ limit: 30 }),
    proposals: listProposals({ limit: 30 }),
    followups: listFollowups({ status: "pending", limit: 50 }),
    events: listAutonomyEvents(60),
  };
}

export type AutonomyOverview = ReturnType<typeof getAutonomyOverview>;
