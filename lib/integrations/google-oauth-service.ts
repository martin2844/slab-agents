import "server-only";

import { finishGoogleCalendarOAuth } from "@/lib/integrations/calendar-service";
import { completeGmailConnection } from "@/lib/integrations/email-service";
import { finishGoogleDataOAuth } from "@/lib/integrations/google-data-service";
import { googleOAuthDestinationForProvider } from "@/lib/integrations/google-oauth-contract";
import { integrationRepository } from "@/lib/repositories/integration-repository";

export type GoogleOAuthCallbackResult =
  | {
      destination: "integrations";
      status: "connected" | "failed";
      integrationId?: string;
    }
  | {
      destination: "calendar" | "email";
      status: "connected" | "failed";
    };

export async function completeGoogleOAuthCallback(input: {
  state: string;
  code: string;
  providerError: boolean;
}): Promise<GoogleOAuthCallbackResult> {
  const destination = googleOAuthDestinationForProvider(
    integrationRepository.getIntegrationOAuthStateProvider(input.state),
  );
  if (!input.state || !input.code || input.providerError) {
    return { destination, status: "failed" };
  }

  try {
    if (destination === "integrations") {
      const integration = await finishGoogleDataOAuth(input.state, input.code);
      return {
        destination,
        status: "connected",
        integrationId: integration.id,
      };
    }
    if (destination === "calendar") {
      await finishGoogleCalendarOAuth(input.state, input.code);
      return { destination, status: "connected" };
    }
    await completeGmailConnection(input.code, input.state);
    return { destination, status: "connected" };
  } catch {
    return { destination, status: "failed" };
  }
}
