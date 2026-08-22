import type { Metadata } from "next";
import { SettingsView } from "@/components/settings-view";
import { getEmailIntegrationState } from "@/lib/integrations/email-service";
import { listCalendarIntegrations } from "@/lib/integrations/calendar-service";
import { repository } from "@/lib/repository";
import { getPublicSettings } from "@/lib/settings";
import { getSetupStatus } from "@/lib/setup";
import { authStatus } from "@/lib/auth/service";
import { configuredPublicOrigin } from "@/lib/request-origin";
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
    query.tab === "email"
      ? "email"
      : query.tab === "calendar"
        ? "calendar"
        : "sources";
  const initialEmailOpen =
    query.email === "connected" || query.email === "oauth_failed";
  return (
    <SettingsView
      initialSettings={getPublicSettings()}
      initialSetup={getSetupStatus()}
      initialEmail={await getEmailIntegrationState()}
      initialCalendars={listCalendarIntegrations()}
      auth={authStatus()}
      agents={repository.listAgents()}
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
    />
  );
}
