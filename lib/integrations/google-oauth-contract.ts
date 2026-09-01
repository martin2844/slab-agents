export const GOOGLE_OAUTH_CALLBACK_PATH = "/api/integrations/google/callback";

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
