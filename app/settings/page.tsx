import type { Metadata } from "next";
import { SettingsView } from "@/components/settings-view";
import { getEmailIntegrationState } from "@/lib/integrations/email-service";
import { repository } from "@/lib/repository";
import { getPublicSettings } from "@/lib/settings";
import { getSetupStatus } from "@/lib/setup";
import { authStatus } from "@/lib/auth/service";
export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";
export default async function SettingsPage() {
  return (
    <SettingsView
      initialSettings={getPublicSettings()}
      initialSetup={getSetupStatus()}
      initialEmail={await getEmailIntegrationState()}
      auth={authStatus()}
      agents={repository.listAgents()}
    />
  );
}
