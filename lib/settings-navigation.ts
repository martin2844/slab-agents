export type SettingsPage =
  | "connections"
  | "operator"
  | "runtime"
  | "budgets"
  | "email"
  | "notifications"
  | "calendar"
  | "memory"
  | "security";

const SETTINGS_PAGES = new Set<SettingsPage>([
  "connections",
  "operator",
  "runtime",
  "budgets",
  "email",
  "notifications",
  "calendar",
  "memory",
  "security",
]);

export function parseSettingsPage(value: string | undefined): SettingsPage {
  return value && SETTINGS_PAGES.has(value as SettingsPage)
    ? (value as SettingsPage)
    : "connections";
}

export function settingsPageUrl(currentUrl: string, page: SettingsPage) {
  const url = new URL(currentUrl);
  url.searchParams.set("tab", page);
  url.searchParams.delete("email");
  url.searchParams.delete("calendar");
  return url;
}

export function clearSettingsCallback(
  currentUrl: string,
  parameter: "email" | "calendar",
) {
  const url = new URL(currentUrl);
  url.searchParams.delete(parameter);
  return url;
}
