import type { Metadata } from "next";
import { headers } from "next/headers";
import { IntegrationsView } from "@/components/integrations-view";
import { getIntegrationsPageData } from "@/lib/page-data";
import {
  configuredPublicOrigin,
  forwardedRequestOrigin,
} from "@/lib/request-origin";

export const metadata: Metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const query = await searchParams;
  const callbackOrigin =
    configuredPublicOrigin() || forwardedRequestOrigin(await headers());

  return (
    <IntegrationsView
      initialData={getIntegrationsPageData()}
      callbackOrigin={callbackOrigin}
      googleResult={
        query.google === "connected" || query.google === "failed"
          ? query.google
          : null
      }
    />
  );
}
