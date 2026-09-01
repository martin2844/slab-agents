// Keep the callback that existing Gmail OAuth clients already allowlisted.
// The handler routes Analytics, Search Console, Calendar, and Gmail by the
// server-owned OAuth state, so every Google capability can share this URI.
export const GOOGLE_OAUTH_CALLBACK_PATH =
  "/api/integrations/email/google/callback";

export type GoogleOAuthDestination = "calendar" | "email" | "integrations";

export function googleOAuthDestinationForProvider(
  provider: string | null,
): GoogleOAuthDestination {
  if (provider === "google_analytics" || provider === "google_search_console") {
    return "integrations";
  }
  if (provider === "calendar_google") return "calendar";
  return "email";
}

export function googleOAuthCallbackUrl(origin: string) {
  return origin
    ? new URL(GOOGLE_OAUTH_CALLBACK_PATH, origin).toString()
    : GOOGLE_OAUTH_CALLBACK_PATH;
}
