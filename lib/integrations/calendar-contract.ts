import type { CalendarProvider, CalendarWritePolicy } from "@/lib/types";

export const CALENDAR_READ_TOOLS = [
  "calendar_list_calendars",
  "calendar_list_events",
  "calendar_get_event",
  "calendar_find_availability",
] as const;

export const CALENDAR_WRITE_TOOLS = [
  "calendar_create_event",
  "calendar_update_event",
  "calendar_cancel_event",
] as const;

export const CALENDAR_TOOLS = [
  ...CALENDAR_READ_TOOLS,
  ...CALENDAR_WRITE_TOOLS,
] as const;

export type CalendarTool = (typeof CALENDAR_TOOLS)[number];

export type CalendarCredentials = {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  accessToken?: string;
  accessTokenExpiresAt?: string;
  username?: string;
  password?: string;
  apiKey?: string;
  feedUrl?: string;
};

export type CalendarConnectionInput = {
  id?: string;
  expectedVersion?: number;
  provider: CalendarProvider;
  name: string;
  baseUrl?: string;
  accountEmail?: string;
  accountName?: string;
  username?: string;
  password?: string;
  apiKey?: string;
  feedUrl?: string;
  clientId?: string;
  clientSecret?: string;
  tenant?: string;
  eventTypeId?: number | null;
  writePolicy?: CalendarWritePolicy;
  enabled?: boolean;
  agentIds?: string[];
};

export type CalendarSummary = {
  id: string;
  name: string;
  primary?: boolean;
  timeZone?: string | null;
  writable?: boolean;
};

export type CalendarEvent = {
  id: string;
  calendarId: string;
  title: string;
  description?: string | null;
  location?: string | null;
  start: string;
  end: string;
  allDay: boolean;
  status: string;
  organizer?: string | null;
  attendees: Array<{ email: string; name?: string | null; status?: string }>;
  version?: string | null;
  url?: string | null;
};

export type CalendarEventInput = {
  calendarId?: string;
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  timeZone?: string;
  allDay?: boolean;
  attendees?: Array<{ email: string; name?: string }>;
  attendeeName?: string;
  attendeeEmail?: string;
};

export type CalendarEventPatch = Partial<CalendarEventInput> & {
  id: string;
  version?: string;
  reason?: string;
};

export type CalendarAdapter = {
  test(): Promise<{ accountEmail?: string; accountName?: string }>;
  listCalendars(): Promise<CalendarSummary[]>;
  listEvents(input: {
    calendarId?: string;
    from: string;
    to: string;
    limit: number;
    pageToken?: string;
  }): Promise<{ events: CalendarEvent[]; nextPageToken?: string | null }>;
  getEvent(input: {
    calendarId?: string;
    eventId: string;
  }): Promise<CalendarEvent>;
  findAvailability(input: {
    calendarIds?: string[];
    from: string;
    to: string;
  }): Promise<
    Array<{ calendarId: string; busy: Array<{ start: string; end: string }> }>
  >;
  createEvent?(input: CalendarEventInput): Promise<CalendarEvent>;
  updateEvent?(input: CalendarEventPatch): Promise<CalendarEvent>;
  cancelEvent?(input: {
    calendarId?: string;
    eventId: string;
    version?: string;
    reason?: string;
  }): Promise<{ id: string; status: "cancelled" }>;
};

export function isCalendarProvider(value: string): value is CalendarProvider {
  return [
    "calendar_google",
    "calendar_microsoft",
    "calendar_caldav",
    "calendar_calcom",
    "calendar_ics",
  ].includes(value);
}

export function normalizeWritePolicy(
  value: CalendarWritePolicy | undefined,
): CalendarWritePolicy {
  return value === "disabled" || value === "autonomous"
    ? value
    : "approval_required";
}

export function calendarOAuthIdentityChanged(input: {
  provider: CalendarProvider;
  currentClientId?: string;
  nextClientId?: string;
  currentTenant?: string;
  nextTenant?: string;
  replacesClientSecret: boolean;
}) {
  if (
    input.provider !== "calendar_google" &&
    input.provider !== "calendar_microsoft"
  )
    return false;
  return (
    Boolean(
      input.nextClientId && input.nextClientId !== input.currentClientId,
    ) ||
    input.replacesClientSecret ||
    (input.provider === "calendar_microsoft" &&
      Boolean(
        input.nextTenant &&
        input.nextTenant !== (input.currentTenant ?? "common"),
      ))
  );
}

export function clearCalendarOAuthGrant(credentials: CalendarCredentials) {
  const next = { ...credentials };
  delete next.accessToken;
  delete next.refreshToken;
  delete next.accessTokenExpiresAt;
  return next;
}
