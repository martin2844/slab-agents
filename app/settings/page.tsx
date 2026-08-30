import { agentRepository } from "@/lib/repositories/agent-repository";
import type { Metadata } from "next";
import { SettingsView } from "@/components/settings-view";
import { getEmailIntegrationState } from "@/lib/integrations/email-service";
import { listCalendarIntegrations } from "@/lib/integrations/calendar-service";
import { getPublicSettings } from "@/lib/settings";
import { getSetupStatus } from "@/lib/setup";
import { authStatus } from "@/lib/auth/service";
import { configuredPublicOrigin } from "@/lib/request-origin";
import { listRuntimeCatalog } from "@/lib/runtime-service";
import { getBudgetConfiguration } from "@/lib/budget-control";
import { getOperatorNotificationState } from "@/lib/operator-notification-service";
export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    email?: string;
    calendar?: string;
  }>;
}) {
  const query = await searchParams;
  const initialTab =
    query.tab === "runtime"
      ? "runtime"
      : query.tab === "email"
        ? "email"
      : query.tab === "notifications"
        ? "notifications"
      : query.tab === "calendar"
        ? "calendar"
        : query.tab === "memory"
          ? "memory"
          : query.tab === "security"
            ? "security"
            : "connections";
  const initialEmailOpen =
    query.email === "connected" || query.email === "oauth_failed";
  return (
    <SettingsView
      initialSettings={getPublicSettings()}
      initialSetup={getSetupStatus()}
      initialEmail={await getEmailIntegrationState()}
      initialNotifications={getOperatorNotificationState()}
      initialCalendars={listCalendarIntegrations()}
      auth={authStatus()}
      agents={agentRepository.listAgents()}
      initialTab={initialTab}
      initialEmailOpen={initialEmailOpen}
      initialCalendarOpen={
        query.calendar === "connected" || query.calendar === "failed"
      }
      initialCalendarResult={
        query.calendar === "connected" || query.calendar === "failed"
          ? query.calendar
          : null
      }
      calendarCallbackOrigin={configuredPublicOrigin()}
      initialRuntimes={await listRuntimeCatalog()}
      initialBudget={getBudgetConfiguration()}
    />
  );
}
