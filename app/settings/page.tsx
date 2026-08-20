import type { Metadata } from "next";
import { SettingsView } from "@/components/settings-view";
import { getEmailIntegrationState } from "@/lib/integrations/email-service";
import { repository } from "@/lib/repository";
import { getPublicSettings } from "@/lib/settings";
import { getSetupStatus } from "@/lib/setup";
import { authStatus } from "@/lib/auth/service";
export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; email?: string }>;
}) {
  const query = await searchParams;
  const initialTab = query.tab === "email" ? "email" : "sources";
  const initialEmailOpen =
    query.email === "connected" || query.email === "oauth_failed";
  return (
    <SettingsView
      initialSettings={getPublicSettings()}
      initialSetup={getSetupStatus()}
      initialEmail={await getEmailIntegrationState()}
      auth={authStatus()}
      agents={repository.listAgents()}
      initialTab={initialTab}
      initialEmailOpen={initialEmailOpen}
    />
  );
}
