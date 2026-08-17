import type { Metadata } from "next";
import { SettingsView } from "@/components/settings-view";
import { getPublicSettings } from "@/lib/settings";
import { getSetupStatus } from "@/lib/setup";
export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";
export default function SettingsPage() {
  return (
    <SettingsView
      initialSettings={getPublicSettings()}
      initialSetup={getSetupStatus()}
    />
  );
}
