import "server-only";

import type { IntegrationRecord } from "@/lib/repositories/integration-repository";

import { randomUUID } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import ICAL from "ical.js";

import type {
  CalendarAdapter,
  CalendarCredentials,
  CalendarEvent,
  CalendarEventInput,
} from "@/lib/integrations/calendar-contract";

const MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_AVAILABILITY_EVENTS = 1000;
const MAX_AVAILABILITY_PAGES = 10;
const MAX_AVAILABILITY_REQUESTS = 3;

function incompleteAvailability(message: string): never {
  throw new CalendarProviderError("CALENDAR_AVAILABILITY_INCOMPLETE", message);
}

export class CalendarProviderError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "CalendarProviderError";
    this.code = code;
    this.status = status;
  }
}

function assertDate(value: string, field: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new CalendarProviderError(
      "CALENDAR_INVALID_INPUT",
      `${field} must be an ISO date or timestamp.`,
    );
  }
  return new Date(parsed);
}

export function assertTimeRange(from: string, to: string) {
  const start = assertDate(from, "from");
  const end = assertDate(to, "to");
  if (end <= start) {
    throw new CalendarProviderError(
      "CALENDAR_INVALID_INPUT",
      "to must be after from.",
    );
  }
  if (end.getTime() - start.getTime() > 366 * 24 * 60 * 60 * 1000) {
    throw new CalendarProviderError(
      "CALENDAR_INVALID_INPUT",
      "Calendar queries are limited to 366 days.",
    );
  }
  return { start, end };
}

async function readLimited(
  response: Response,
  maxBytes = MAX_PROVIDER_RESPONSE_BYTES,
) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new CalendarProviderError(
      "CALENDAR_RESPONSE_TOO_LARGE",
      `Calendar provider response exceeded ${maxBytes} bytes.`,
      response.status,
    );
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new CalendarProviderError(
        "CALENDAR_RESPONSE_TOO_LARGE",
        `Calendar provider response exceeded ${maxBytes} bytes.`,
        response.status,
      );
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function providerFetch(
  url: string | URL,
  init: RequestInit = {},
  options: { maxBytes?: number; timeoutMs?: number } = {},
) {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      throw new CalendarProviderError(
        "CALENDAR_TIMEOUT",
        "The calendar provider did not respond in time.",
      );
    }
    throw new CalendarProviderError(
      "CALENDAR_CONNECTION_FAILED",
      "The calendar provider could not be reached.",
    );
  }
  if (response.status >= 300 && response.status < 400) {
    throw new CalendarProviderError(
      "CALENDAR_REDIRECT_BLOCKED",
      "The calendar provider attempted an unexpected redirect.",
      response.status,
    );
  }
  const bytes = await readLimited(response, options.maxBytes);
  return { response, bytes, text: new TextDecoder().decode(bytes) };
}

async function jsonRequest<T>(
  url: string | URL,
  init: RequestInit = {},
  options?: { maxBytes?: number; timeoutMs?: number },
) {
  const result = await providerFetch(url, init, options);
  let body: unknown = null;
  try {
    body = result.text ? JSON.parse(result.text) : null;
  } catch {
    throw new CalendarProviderError(
      "CALENDAR_INVALID_RESPONSE",
      "The calendar provider returned invalid JSON.",
      result.response.status,
    );
  }
  if (!result.response.ok) {
    throw new CalendarProviderError(
      result.response.status === 401 || result.response.status === 403
        ? "CALENDAR_AUTH_FAILED"
        : "CALENDAR_PROVIDER_ERROR",
      `Calendar provider returned HTTP ${result.response.status}.`,
      result.response.status,
    );
  }
  return body as T;
}

function normalizeGoogleEvent(
  item: Record<string, unknown>,
  calendarId: string,
): CalendarEvent {
  const start = (item.start ?? {}) as Record<string, unknown>;
  const end = (item.end ?? {}) as Record<string, unknown>;
  const allDay = Boolean(start.date && !start.dateTime);
  const attendees = Array.isArray(item.attendees) ? item.attendees : [];
  return {
    id: String(item.id ?? ""),
    calendarId,
    title: String(item.summary ?? "Untitled event"),
    description: item.description ? String(item.description) : null,
    location: item.location ? String(item.location) : null,
    start: String(start.dateTime ?? start.date ?? ""),
    end: String(end.dateTime ?? end.date ?? ""),
    allDay,
    status: String(item.status ?? "confirmed"),
    organizer:
      item.organizer && typeof item.organizer === "object"
        ? String((item.organizer as Record<string, unknown>).email ?? "") ||
          null
        : null,
    attendees: attendees.slice(0, 100).map((entry) => {
      const attendee = entry as Record<string, unknown>;
      return {
        email: String(attendee.email ?? ""),
        name: attendee.displayName ? String(attendee.displayName) : null,
        status: attendee.responseStatus
          ? String(attendee.responseStatus)
          : undefined,
      };
    }),
    version: item.etag ? String(item.etag) : null,
    url: item.htmlLink ? String(item.htmlLink) : null,
  };
}

function googleEventBody(input: Partial<CalendarEventInput>) {
  const allDay = input.allDay === true;
  return {
    ...(input.title ? { summary: input.title } : {}),
    ...(typeof input.description === "string"
      ? { description: input.description }
      : {}),
    ...(typeof input.location === "string" ? { location: input.location } : {}),
    ...(input.start
      ? {
          start: allDay
            ? { date: input.start.slice(0, 10) }
            : {
                dateTime: input.start,
                ...(input.timeZone ? { timeZone: input.timeZone } : {}),
              },
        }
      : {}),
    ...(input.end
      ? {
          end: allDay
            ? { date: input.end.slice(0, 10) }
            : {
                dateTime: input.end,
                ...(input.timeZone ? { timeZone: input.timeZone } : {}),
              },
        }
      : {}),
    ...(input.attendees
      ? {
          attendees: input.attendees.slice(0, 100).map(({ email, name }) => ({
            email,
            ...(name ? { displayName: name } : {}),
          })),
        }
      : {}),
  };
}

type TokenUpdater = (credentials: CalendarCredentials) => void;

export function createGoogleCalendarAdapter(
  credentials: CalendarCredentials,
  updateCredentials: TokenUpdater,
): CalendarAdapter {
  async function accessToken() {
    if (
      credentials.accessToken &&
      credentials.accessTokenExpiresAt &&
      Date.parse(credentials.accessTokenExpiresAt) > Date.now() + 60_000
    ) {
      return credentials.accessToken;
    }
    if (
      !credentials.clientId ||
      !credentials.clientSecret ||
      !credentials.refreshToken
    ) {
      throw new CalendarProviderError(
        "CALENDAR_AUTH_REQUIRED",
        "Google Calendar authorization is incomplete.",
      );
    }
    const body = new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: "refresh_token",
    });
    const token = await jsonRequest<{
      access_token: string;
      expires_in?: number;
    }>("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    credentials.accessToken = token.access_token;
    credentials.accessTokenExpiresAt = new Date(
      Date.now() + Math.max(60, token.expires_in ?? 3600) * 1000,
    ).toISOString();
    updateCredentials(credentials);
    return token.access_token;
  }

  async function request<T>(path: string, init: RequestInit = {}) {
    const token = await accessToken();
    return jsonRequest<T>(`https://www.googleapis.com/calendar/v3${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
  }

  return {
    async test() {
      const calendar =
        await request<Record<string, unknown>>("/calendars/primary");
      return {
        accountEmail: String(calendar.id ?? ""),
        accountName: String(
          calendar.summary ?? calendar.id ?? "Google Calendar",
        ),
      };
    },
    async listCalendars() {
      const result = await request<{ items?: Array<Record<string, unknown>> }>(
        "/users/me/calendarList?maxResults=100&minAccessRole=reader",
      );
      return (result.items ?? []).map((item) => ({
        id: String(item.id),
        name: String(item.summary ?? item.id),
        primary: item.primary === true,
        timeZone: item.timeZone ? String(item.timeZone) : null,
        writable: ["writer", "owner"].includes(String(item.accessRole)),
      }));
    },
    async listEvents(input) {
      assertTimeRange(input.from, input.to);
      const calendarId = input.calendarId || "primary";
      const query = new URLSearchParams({
        timeMin: new Date(input.from).toISOString(),
        timeMax: new Date(input.to).toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: String(Math.min(100, Math.max(1, input.limit))),
        ...(input.pageToken ? { pageToken: input.pageToken } : {}),
      });
      const result = await request<{
        items?: Array<Record<string, unknown>>;
        nextPageToken?: string;
      }>(`/calendars/${encodeURIComponent(calendarId)}/events?${query}`);
      return {
        events: (result.items ?? []).map((item) =>
          normalizeGoogleEvent(item, calendarId),
        ),
        nextPageToken: result.nextPageToken ?? null,
      };
    },
    async getEvent({ calendarId = "primary", eventId }) {
      const item = await request<Record<string, unknown>>(
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      );
      return normalizeGoogleEvent(item, calendarId);
    },
    async findAvailability(input) {
      assertTimeRange(input.from, input.to);
      const ids = input.calendarIds?.length ? input.calendarIds : ["primary"];
      const result = await request<{
        calendars?: Record<
          string,
          { busy?: Array<{ start: string; end: string }> }
        >;
      }>("/freeBusy", {
        method: "POST",
        body: JSON.stringify({
          timeMin: new Date(input.from).toISOString(),
          timeMax: new Date(input.to).toISOString(),
          items: ids.slice(0, 50).map((id) => ({ id })),
        }),
      });
      return ids.map((id) => ({
        calendarId: id,
        busy: result.calendars?.[id]?.busy ?? [],
      }));
    },
    async createEvent(input) {
      assertTimeRange(input.start, input.end);
      const calendarId = input.calendarId || "primary";
      const item = await request<Record<string, unknown>>(
        `/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`,
        { method: "POST", body: JSON.stringify(googleEventBody(input)) },
      );
      return normalizeGoogleEvent(item, calendarId);
    },
    async updateEvent(input) {
      const calendarId = input.calendarId || "primary";
      const item = await request<Record<string, unknown>>(
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(input.id)}?sendUpdates=all`,
        {
          method: "PATCH",
          headers: input.version ? { "If-Match": input.version } : {},
          body: JSON.stringify(googleEventBody(input)),
        },
      );
      return normalizeGoogleEvent(item, calendarId);
    },
    async cancelEvent({ calendarId = "primary", eventId, version }) {
      const token = await accessToken();
      const result = await providerFetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
            ...(version ? { "If-Match": version } : {}),
          },
        },
      );
      if (!result.response.ok && result.response.status !== 404) {
        throw new CalendarProviderError(
          "CALENDAR_PROVIDER_ERROR",
          `Google Calendar returned HTTP ${result.response.status}.`,
          result.response.status,
        );
      }
      return { id: eventId, status: "cancelled" };
    },
  };
}

function normalizeMicrosoftEvent(
  item: Record<string, unknown>,
  calendarId: string,
): CalendarEvent {
  const start = (item.start ?? {}) as Record<string, unknown>;
  const end = (item.end ?? {}) as Record<string, unknown>;
  const attendees = Array.isArray(item.attendees) ? item.attendees : [];
  const microsoftDate = (value: unknown, zone: unknown) => {
    const raw = String(value ?? "");
    if (!raw) return raw;
    if (/[zZ]|[+-]\d{2}:\d{2}$/.test(raw)) return new Date(raw).toISOString();
    if (!zone || String(zone).toUpperCase() === "UTC") {
      return new Date(`${raw}Z`).toISOString();
    }
    return raw;
  };
  return {
    id: String(item.id ?? ""),
    calendarId,
    title: String(item.subject ?? "Untitled event"),
    description: item.bodyPreview ? String(item.bodyPreview) : null,
    location:
      item.location && typeof item.location === "object"
        ? String(
            (item.location as Record<string, unknown>).displayName ?? "",
          ) || null
        : null,
    start: microsoftDate(start.dateTime, start.timeZone),
    end: microsoftDate(end.dateTime, end.timeZone),
    allDay: item.isAllDay === true,
    status: item.isCancelled === true ? "cancelled" : "confirmed",
    organizer:
      item.organizer && typeof item.organizer === "object"
        ? String(
            (
              ((item.organizer as Record<string, unknown>).emailAddress ??
                {}) as Record<string, unknown>
            ).address ?? "",
          ) || null
        : null,
    attendees: attendees.slice(0, 100).map((entry) => {
      const attendee = entry as Record<string, unknown>;
      const address = (attendee.emailAddress ?? {}) as Record<string, unknown>;
      const status = (attendee.status ?? {}) as Record<string, unknown>;
      return {
        email: String(address.address ?? ""),
        name: address.name ? String(address.name) : null,
        status: status.response ? String(status.response) : undefined,
      };
    }),
    version: item.changeKey ? String(item.changeKey) : null,
    url: item.webLink ? String(item.webLink) : null,
  };
}

function microsoftEventBody(input: Partial<CalendarEventInput>) {
  const dateTime = (value: string) =>
    input.allDay ? `${value.slice(0, 10)}T00:00:00` : value;
  return {
    ...(input.title ? { subject: input.title } : {}),
    ...(typeof input.description === "string"
      ? { body: { contentType: "text", content: input.description } }
      : {}),
    ...(typeof input.location === "string"
      ? { location: { displayName: input.location } }
      : {}),
    ...(input.start
      ? {
          start: {
            dateTime: dateTime(input.start),
            timeZone: input.timeZone || "UTC",
          },
        }
      : {}),
    ...(input.end
      ? {
          end: {
            dateTime: dateTime(input.end),
            timeZone: input.timeZone || "UTC",
          },
        }
      : {}),
    ...(typeof input.allDay === "boolean" ? { isAllDay: input.allDay } : {}),
    ...(input.attendees
      ? {
          attendees: input.attendees.slice(0, 100).map(({ email, name }) => ({
            type: "required",
            emailAddress: { address: email, ...(name ? { name } : {}) },
          })),
        }
      : {}),
  };
}

export function createMicrosoftCalendarAdapter(
  credentials: CalendarCredentials,
  tenant: string,
  updateCredentials: TokenUpdater,
): CalendarAdapter {
  async function accessToken() {
    if (
      credentials.accessToken &&
      credentials.accessTokenExpiresAt &&
      Date.parse(credentials.accessTokenExpiresAt) > Date.now() + 60_000
    )
      return credentials.accessToken;
    if (
      !credentials.clientId ||
      !credentials.clientSecret ||
      !credentials.refreshToken
    ) {
      throw new CalendarProviderError(
        "CALENDAR_AUTH_REQUIRED",
        "Microsoft Calendar authorization is incomplete.",
      );
    }
    const token = await jsonRequest<{
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    }>(
      `https://login.microsoftonline.com/${encodeURIComponent(tenant || "common")}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          refresh_token: credentials.refreshToken,
          grant_type: "refresh_token",
          scope: "offline_access User.Read Calendars.ReadWrite",
        }),
      },
    );
    credentials.accessToken = token.access_token;
    credentials.refreshToken = token.refresh_token ?? credentials.refreshToken;
    credentials.accessTokenExpiresAt = new Date(
      Date.now() + Math.max(60, token.expires_in ?? 3600) * 1000,
    ).toISOString();
    updateCredentials(credentials);
    return token.access_token;
  }
  async function request<T>(path: string, init: RequestInit = {}) {
    const token = await accessToken();
    return jsonRequest<T>(`https://graph.microsoft.com/v1.0${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        Prefer: 'outlook.timezone="UTC"',
        ...(init.headers ?? {}),
      },
    });
  }
  async function listEvents(input: {
    calendarId?: string;
    from: string;
    to: string;
    limit: number;
    pageToken?: string;
  }) {
    assertTimeRange(input.from, input.to);
    const base = input.calendarId
      ? `/me/calendars/${encodeURIComponent(input.calendarId)}/calendarView`
      : "/me/calendarView";
    const query = new URLSearchParams({
      startDateTime: new Date(input.from).toISOString(),
      endDateTime: new Date(input.to).toISOString(),
      $top: String(Math.min(100, Math.max(1, input.limit))),
      $orderby: "start/dateTime",
    });
    let path = `${base}?${query}`;
    if (input.pageToken) {
      const next = new URL(input.pageToken);
      if (
        next.origin !== "https://graph.microsoft.com" ||
        !next.pathname.startsWith("/v1.0/me/")
      ) {
        throw new CalendarProviderError(
          "CALENDAR_INVALID_INPUT",
          "Microsoft Calendar page token is invalid.",
        );
      }
      path = `${next.pathname.replace(/^\/v1\.0/, "")}${next.search}`;
    }
    const result = await request<{
      value?: Array<Record<string, unknown>>;
      "@odata.nextLink"?: string;
    }>(path);
    return {
      events: (result.value ?? []).map((item) =>
        normalizeMicrosoftEvent(item, input.calendarId ?? "primary"),
      ),
      nextPageToken: result["@odata.nextLink"] ?? null,
    };
  }
  return {
    async test() {
      const me = await request<Record<string, unknown>>(
        "/me?$select=displayName,mail,userPrincipalName",
      );
      return {
        accountEmail: String(me.mail ?? me.userPrincipalName ?? ""),
        accountName: String(me.displayName ?? me.mail ?? "Microsoft Calendar"),
      };
    },
    async listCalendars() {
      const result = await request<{ value?: Array<Record<string, unknown>> }>(
        "/me/calendars?$top=100",
      );
      return (result.value ?? []).map((item) => ({
        id: String(item.id),
        name: String(item.name ?? item.id),
        primary: item.isDefaultCalendar === true,
        writable: item.canEdit !== false,
      }));
    },
    listEvents,
    async getEvent({ calendarId, eventId }) {
      const path = calendarId
        ? `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
        : `/me/events/${encodeURIComponent(eventId)}`;
      return normalizeMicrosoftEvent(
        await request<Record<string, unknown>>(path),
        calendarId ?? "primary",
      );
    },
    async findAvailability(input) {
      assertTimeRange(input.from, input.to);
      const calendars = input.calendarIds?.length
        ? input.calendarIds.slice(0, 20)
        : [undefined];
      const output = [];
      let remainingRequests = MAX_AVAILABILITY_REQUESTS;
      for (const calendarId of calendars) {
        const events: CalendarEvent[] = [];
        let pageToken: string | undefined;
        for (let page = 0; page < MAX_AVAILABILITY_PAGES; page += 1) {
          if (remainingRequests <= 0) {
            incompleteAvailability(
              "Availability exceeded the whole-operation request bound. Query fewer calendars or a narrower time range.",
            );
          }
          remainingRequests -= 1;
          const result = await listEvents({
            calendarId,
            from: input.from,
            to: input.to,
            limit: 100,
            pageToken,
          });
          events.push(...result.events);
          if (!result.nextPageToken) {
            pageToken = undefined;
            break;
          }
          if (result.nextPageToken === pageToken) {
            throw new CalendarProviderError(
              "CALENDAR_AVAILABILITY_INCOMPLETE",
              "Microsoft Calendar repeated a pagination cursor; availability could not be verified completely.",
            );
          }
          pageToken = result.nextPageToken;
        }
        if (pageToken || events.length > MAX_AVAILABILITY_EVENTS) {
          throw new CalendarProviderError(
            "CALENDAR_AVAILABILITY_INCOMPLETE",
            `Availability exceeded the ${MAX_AVAILABILITY_EVENTS}-event safety bound. Narrow the time range.`,
          );
        }
        output.push({
          calendarId: calendarId ?? "primary",
          busy: events
            .filter((event) => event.status !== "cancelled")
            .map(({ start, end }) => ({ start, end })),
        });
      }
      return output;
    },
    async createEvent(input) {
      assertTimeRange(input.start, input.end);
      const path = input.calendarId
        ? `/me/calendars/${encodeURIComponent(input.calendarId)}/events`
        : "/me/calendar/events";
      return normalizeMicrosoftEvent(
        await request<Record<string, unknown>>(path, {
          method: "POST",
          body: JSON.stringify(microsoftEventBody(input)),
        }),
        input.calendarId ?? "primary",
      );
    },
    async updateEvent(input) {
      const path = input.calendarId
        ? `/me/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.id)}`
        : `/me/events/${encodeURIComponent(input.id)}`;
      return normalizeMicrosoftEvent(
        await request<Record<string, unknown>>(path, {
          method: "PATCH",
          headers: input.version ? { "If-Match": input.version } : {},
          body: JSON.stringify(microsoftEventBody(input)),
        }),
        input.calendarId ?? "primary",
      );
    },
    async cancelEvent({ calendarId, eventId, version, reason }) {
      const path = calendarId
        ? `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/cancel`
        : `/me/events/${encodeURIComponent(eventId)}/cancel`;
      await request(path, {
        method: "POST",
        headers: version ? { "If-Match": version } : {},
        body: JSON.stringify({
          comment: reason ?? "Cancelled by Slab Agent Workspace",
        }),
      });
      return { id: eventId, status: "cancelled" };
    },
  };
}

function scalarParameter(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function decodeCalendarData(
  text: string,
  calendarId: string,
  eventId: string,
  version?: string | null,
): CalendarEvent {
  const root = new ICAL.Component(ICAL.parse(text));
  const component = root.getFirstSubcomponent("vevent");
  if (!component)
    throw new CalendarProviderError(
      "CALENDAR_INVALID_RESPONSE",
      "Calendar data did not contain an event.",
    );
  const event = new ICAL.Event(component);
  return {
    id: eventId,
    calendarId,
    title: event.summary || "Untitled event",
    description: event.description || null,
    location: event.location || null,
    start: event.startDate.toJSDate().toISOString(),
    end: event.endDate.toJSDate().toISOString(),
    allDay: event.startDate.isDate,
    status: String(
      component.getFirstPropertyValue("status") ?? "confirmed",
    ).toLowerCase(),
    organizer:
      String(component.getFirstPropertyValue("organizer") ?? "").replace(
        /^mailto:/i,
        "",
      ) || null,
    attendees: component
      .getAllProperties("attendee")
      .slice(0, 100)
      .map((property) => ({
        email: String(property.getFirstValue() ?? "").replace(/^mailto:/i, ""),
        name: scalarParameter(property.getParameter("cn")) || null,
        status: scalarParameter(property.getParameter("partstat")) || undefined,
      })),
    version: version ?? null,
    url: null,
  } satisfies CalendarEvent;
}

function calendarTime(value: string, allDay: boolean, timeZone?: string) {
  if (allDay) return ICAL.Time.fromDateString(value.slice(0, 10));
  let normalized = value;
  if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(normalized)) {
    if (!timeZone || timeZone.toUpperCase() !== "UTC") {
      throw new CalendarProviderError(
        "CALENDAR_INVALID_INPUT",
        "CalDAV timed events require an offset-aware ISO timestamp. Use Z or an explicit UTC offset.",
      );
    }
    normalized = `${normalized}Z`;
  }
  const parsed = assertDate(normalized, "event time");
  return ICAL.Time.fromJSDate(parsed, true);
}

function replaceAttendees(
  component: ICAL.Component,
  attendees: CalendarEventInput["attendees"],
) {
  component.removeAllProperties("attendee");
  for (const attendee of attendees ?? []) {
    const property = new ICAL.Property("attendee");
    property.setValue(`mailto:${attendee.email}`);
    if (attendee.name) property.setParameter("cn", attendee.name);
    component.addProperty(property);
  }
}

function calendarEventToIcs(
  input: CalendarEventInput,
  uid: string = randomUUID(),
) {
  assertTimeRange(input.start, input.end);
  const component = new ICAL.Component(["vcalendar", [], []]);
  component.updatePropertyWithValue("version", "2.0");
  component.updatePropertyWithValue("prodid", "-//Slab Agents//Calendar//EN");
  const eventComponent = new ICAL.Component("vevent");
  const event = new ICAL.Event(eventComponent);
  event.uid = uid as `${string}-${string}-${string}-${string}-${string}`;
  event.summary = input.title;
  event.description = input.description ?? "";
  event.location = input.location ?? "";
  event.startDate = calendarTime(
    input.start,
    input.allDay === true,
    input.timeZone,
  );
  event.endDate = calendarTime(
    input.end,
    input.allDay === true,
    input.timeZone,
  );
  eventComponent.updatePropertyWithValue("dtstamp", ICAL.Time.now());
  replaceAttendees(eventComponent, input.attendees);
  component.addSubcomponent(eventComponent);
  return component.toString();
}

function patchCalendarEventIcs(
  source: string,
  input: Parameters<NonNullable<CalendarAdapter["updateEvent"]>>[0],
) {
  const root = new ICAL.Component(ICAL.parse(source));
  const component = root.getFirstSubcomponent("vevent");
  if (!component) {
    throw new CalendarProviderError(
      "CALENDAR_INVALID_RESPONSE",
      "Calendar data did not contain an event.",
    );
  }
  const event = new ICAL.Event(component);
  if (input.title !== undefined) event.summary = input.title;
  if (input.description !== undefined) event.description = input.description;
  if (input.location !== undefined) event.location = input.location;
  const shouldRewriteTimes =
    input.start !== undefined ||
    input.end !== undefined ||
    input.allDay !== undefined ||
    input.timeZone !== undefined;
  if (shouldRewriteTimes) {
    const allDay = input.allDay ?? event.startDate.isDate;
    const start = input.start ?? event.startDate.toJSDate().toISOString();
    const end = input.end ?? event.endDate.toJSDate().toISOString();
    assertTimeRange(start, end);
    event.startDate = calendarTime(start, allDay, input.timeZone);
    event.endDate = calendarTime(end, allDay, input.timeZone);
  }
  if (input.attendees !== undefined) {
    replaceAttendees(component, input.attendees);
  }
  component.updatePropertyWithValue("dtstamp", ICAL.Time.now());
  return root.toString();
}

function safeUrlWithin(baseUrl: string, candidate: string) {
  const base = new URL(baseUrl);
  const url = new URL(candidate, base);
  const basePath = base.pathname.endsWith("/")
    ? base.pathname
    : `${base.pathname}/`;
  if (
    url.origin !== base.origin ||
    (url.pathname !== base.pathname && !url.pathname.startsWith(basePath))
  ) {
    throw new CalendarProviderError(
      "CALENDAR_INVALID_INPUT",
      "Calendar identifier is outside the configured CalDAV collection.",
    );
  }
  return url;
}

function caldavAuth(credentials: CalendarCredentials) {
  if (!credentials.username || !credentials.password) {
    throw new CalendarProviderError(
      "CALENDAR_AUTH_REQUIRED",
      "CalDAV credentials are incomplete.",
    );
  }
  return `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`;
}

function xmlResponses(text: string) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    textNodeName: "#text",
  });
  const parsed = parser.parse(text) as Record<string, unknown>;
  const multistatus = (parsed.multistatus ?? parsed) as Record<string, unknown>;
  const response = multistatus.response;
  return Array.isArray(response)
    ? (response as Array<Record<string, unknown>>)
    : response
      ? [response as Record<string, unknown>]
      : [];
}

function propValue(response: Record<string, unknown>, key: string) {
  const propstats = Array.isArray(response.propstat)
    ? response.propstat
    : [response.propstat];
  for (const item of propstats) {
    const prop =
      item && typeof item === "object"
        ? (item as Record<string, unknown>).prop
        : null;
    if (prop && typeof prop === "object" && key in prop)
      return (prop as Record<string, unknown>)[key];
  }
  return undefined;
}

export function createCalDavAdapter(
  record: IntegrationRecord,
  credentials: CalendarCredentials,
): CalendarAdapter {
  const baseUrl = String(record.config.baseUrl ?? "");
  const headers = { Authorization: caldavAuth(credentials) };
  async function dav(
    url: URL,
    method: string,
    body?: string,
    extraHeaders: Record<string, string> = {},
  ) {
    const result = await providerFetch(url, {
      method,
      headers: {
        ...headers,
        ...(body ? { "Content-Type": "application/xml; charset=utf-8" } : {}),
        ...extraHeaders,
      },
      body,
    });
    if (!result.response.ok && result.response.status !== 207) {
      throw new CalendarProviderError(
        result.response.status === 401 || result.response.status === 403
          ? "CALENDAR_AUTH_FAILED"
          : "CALENDAR_PROVIDER_ERROR",
        `CalDAV returned HTTP ${result.response.status}.`,
        result.response.status,
      );
    }
    return result;
  }
  async function listCalendars() {
    const result = await dav(
      new URL(baseUrl),
      "PROPFIND",
      `<?xml version="1.0" encoding="utf-8" ?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/></d:prop></d:propfind>`,
      { Depth: "1" },
    );
    return xmlResponses(result.text).flatMap((response) => {
      const resourceType = propValue(response, "resourcetype");
      const serialized = JSON.stringify(resourceType ?? {});
      if (!serialized.toLowerCase().includes("calendar")) return [];
      const href = String(response.href ?? "");
      const url = safeUrlWithin(baseUrl, href).toString();
      const display = propValue(response, "displayname");
      return [
        {
          id: url,
          name:
            typeof display === "object" && display
              ? String((display as Record<string, unknown>)["#text"] ?? url)
              : String(display ?? url),
          writable: true,
        },
      ];
    });
  }
  async function listEvents(input: {
    calendarId?: string;
    from: string;
    to: string;
    limit: number;
    requireComplete?: boolean;
  }) {
    const { start, end } = assertTimeRange(input.from, input.to);
    const calendarId = input.calendarId || baseUrl;
    const calendarUrl = safeUrlWithin(baseUrl, calendarId);
    const compact = (date: Date) =>
      date
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z");
    const body = `<?xml version="1.0" encoding="utf-8" ?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${compact(start)}" end="${compact(end)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
    const result = await dav(calendarUrl, "REPORT", body, { Depth: "1" });
    const events = xmlResponses(result.text)
      .flatMap((response) => {
        const data = propValue(response, "calendar-data");
        const raw =
          typeof data === "object" && data
            ? String((data as Record<string, unknown>)["#text"] ?? "")
            : String(data ?? "");
        if (!raw) return [];
        if (
          input.requireComplete &&
          /(?:^|\r?\n)(?:RRULE|RDATE|EXDATE|RECURRENCE-ID)[;:]/i.test(raw)
        ) {
          incompleteAvailability(
            "Recurring CalDAV data was not expanded by the server, so complete availability cannot be verified.",
          );
        }
        const href = safeUrlWithin(
          baseUrl,
          String(response.href ?? ""),
        ).toString();
        const etag = propValue(response, "getetag");
        try {
          return [
            decodeCalendarData(
              raw,
              calendarId,
              href,
              etag ? String(etag) : null,
            ),
          ];
        } catch {
          if (input.requireComplete) {
            incompleteAvailability(
              "A CalDAV event could not be decoded, so complete availability cannot be verified.",
            );
          }
          return [];
        }
      })
      .slice(
        0,
        Math.min(MAX_AVAILABILITY_EVENTS + 1, Math.max(1, input.limit)),
      );
    return { events, nextPageToken: null };
  }
  return {
    async test() {
      await listCalendars();
      return { accountEmail: credentials.username, accountName: record.name };
    },
    listCalendars,
    listEvents,
    async getEvent({ calendarId = baseUrl, eventId }) {
      const url = safeUrlWithin(baseUrl, eventId);
      const result = await dav(url, "GET", undefined, {
        Accept: "text/calendar",
      });
      return decodeCalendarData(
        result.text,
        calendarId,
        url.toString(),
        result.response.headers.get("etag"),
      );
    },
    async findAvailability(input) {
      const discoversCalendars = !input.calendarIds?.length;
      const calendars = discoversCalendars
        ? (await listCalendars()).map(({ id }) => id)
        : input.calendarIds!;
      const calendarRequestBudget =
        MAX_AVAILABILITY_REQUESTS - (discoversCalendars ? 1 : 0);
      if (calendars.length > calendarRequestBudget) {
        incompleteAvailability(
          `CalDAV availability is limited to ${calendarRequestBudget} calendars in this call. Query a smaller explicit set.`,
        );
      }
      const output = [];
      for (const calendarId of calendars.slice(0, 20)) {
        const { events } = await listEvents({
          calendarId,
          from: input.from,
          to: input.to,
          limit: MAX_AVAILABILITY_EVENTS + 1,
          requireComplete: true,
        });
        if (events.length > MAX_AVAILABILITY_EVENTS) {
          throw new CalendarProviderError(
            "CALENDAR_AVAILABILITY_INCOMPLETE",
            `Availability exceeded the ${MAX_AVAILABILITY_EVENTS}-event safety bound. Narrow the time range.`,
          );
        }
        output.push({
          calendarId,
          busy: events
            .filter((event) => event.status !== "cancelled")
            .map(({ start, end }) => ({ start, end })),
        });
      }
      return output;
    },
    async createEvent(input) {
      const calendarId = input.calendarId || baseUrl;
      const uid = randomUUID();
      const url = safeUrlWithin(
        baseUrl,
        `${calendarId.replace(/\/$/, "")}/${uid}.ics`,
      );
      const payload = calendarEventToIcs(input, uid);
      const result = await dav(url, "PUT", payload, {
        "Content-Type": "text/calendar; charset=utf-8",
        "If-None-Match": "*",
      });
      return decodeCalendarData(
        payload,
        calendarId,
        url.toString(),
        result.response.headers.get("etag"),
      );
    },
    async updateEvent(input) {
      const url = safeUrlWithin(baseUrl, input.id);
      const currentResult = await dav(url, "GET", undefined, {
        Accept: "text/calendar",
      });
      const currentVersion = currentResult.response.headers.get("etag");
      const expectedVersion = input.version ?? currentVersion;
      if (!expectedVersion) {
        throw new CalendarProviderError(
          "CALENDAR_CONCURRENCY_UNSUPPORTED",
          "The CalDAV server did not provide an ETag, so a safe update is not possible.",
        );
      }
      const payload = patchCalendarEventIcs(currentResult.text, input);
      const result = await dav(
        safeUrlWithin(baseUrl, input.id),
        "PUT",
        payload,
        {
          "Content-Type": "text/calendar; charset=utf-8",
          "If-Match": expectedVersion,
        },
      );
      return decodeCalendarData(
        payload,
        input.calendarId ?? baseUrl,
        input.id,
        result.response.headers.get("etag"),
      );
    },
    async cancelEvent({ eventId, version }) {
      let expectedVersion = version;
      if (!expectedVersion) {
        const current = await dav(
          safeUrlWithin(baseUrl, eventId),
          "GET",
          undefined,
          { Accept: "text/calendar" },
        );
        expectedVersion = current.response.headers.get("etag") ?? undefined;
      }
      if (!expectedVersion) {
        throw new CalendarProviderError(
          "CALENDAR_CONCURRENCY_UNSUPPORTED",
          "The CalDAV server did not provide an ETag, so a safe cancellation is not possible.",
        );
      }
      await dav(safeUrlWithin(baseUrl, eventId), "DELETE", undefined, {
        "If-Match": expectedVersion,
      });
      return { id: eventId, status: "cancelled" };
    },
  };
}

function parseIcsEvents(
  text: string,
  calendarId: string,
  from?: string,
  to?: string,
  limit = 100,
  requireComplete = false,
) {
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch {
    throw new CalendarProviderError(
      "CALENDAR_INVALID_RESPONSE",
      "The calendar feed is not valid iCalendar data.",
    );
  }
  const startBoundary = from
    ? assertDate(from, "from").getTime()
    : Number.NEGATIVE_INFINITY;
  const endBoundary = to
    ? assertDate(to, "to").getTime()
    : Number.POSITIVE_INFINITY;
  return root
    .getAllSubcomponents("vevent")
    .flatMap((component) => {
      if (
        requireComplete &&
        ["rrule", "rdate", "exdate", "recurrence-id"].some((name) =>
          component.hasProperty(name),
        )
      ) {
        incompleteAvailability(
          "Recurring calendar data is not expanded by this provider, so complete availability cannot be verified.",
        );
      }
      try {
        const event = new ICAL.Event(component);
        const start = event.startDate.toJSDate();
        const end = event.endDate.toJSDate();
        if (end.getTime() <= startBoundary || start.getTime() >= endBoundary)
          return [];
        return [
          decodeCalendarData(
            new ICAL.Component([
              "vcalendar",
              [],
              [component.toJSON()],
            ]).toString(),
            calendarId,
            event.uid,
            String(component.getFirstPropertyValue("last-modified") ?? ""),
          ),
        ];
      } catch {
        if (requireComplete) {
          incompleteAvailability(
            "A calendar event could not be decoded, so complete availability cannot be verified.",
          );
        }
        return [];
      }
    })
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, limit);
}

export function createIcsAdapter(
  record: IntegrationRecord,
  credentials: CalendarCredentials,
): CalendarAdapter {
  if (!credentials.feedUrl)
    throw new CalendarProviderError(
      "CALENDAR_AUTH_REQUIRED",
      "The shared calendar URL is missing.",
    );
  const feed = new URL(credentials.feedUrl);
  if (!/^https?:$/.test(feed.protocol))
    throw new CalendarProviderError(
      "CALENDAR_INVALID_INPUT",
      "Shared calendar URLs must use HTTP or HTTPS.",
    );
  async function load() {
    const result = await providerFetch(
      feed,
      { headers: { Accept: "text/calendar" } },
      { maxBytes: MAX_PROVIDER_RESPONSE_BYTES },
    );
    if (!result.response.ok)
      throw new CalendarProviderError(
        "CALENDAR_PROVIDER_ERROR",
        `Calendar feed returned HTTP ${result.response.status}.`,
        result.response.status,
      );
    return result.text;
  }
  return {
    async test() {
      parseIcsEvents(await load(), "shared", undefined, undefined, 1);
      return { accountName: record.name };
    },
    async listCalendars() {
      return [{ id: "shared", name: record.name, writable: false }];
    },
    async listEvents(input) {
      assertTimeRange(input.from, input.to);
      return {
        events: parseIcsEvents(
          await load(),
          "shared",
          input.from,
          input.to,
          Math.min(100, input.limit),
        ),
        nextPageToken: null,
      };
    },
    async getEvent({ eventId }) {
      const event = parseIcsEvents(
        await load(),
        "shared",
        undefined,
        undefined,
        Number.MAX_SAFE_INTEGER,
      ).find(({ id }) => id === eventId);
      if (!event)
        throw new CalendarProviderError(
          "CALENDAR_NOT_FOUND",
          "Calendar event was not found.",
          404,
        );
      return event;
    },
    async findAvailability(input) {
      assertTimeRange(input.from, input.to);
      const events = parseIcsEvents(
        await load(),
        "shared",
        input.from,
        input.to,
        MAX_AVAILABILITY_EVENTS + 1,
        true,
      );
      if (events.length > MAX_AVAILABILITY_EVENTS) {
        throw new CalendarProviderError(
          "CALENDAR_AVAILABILITY_INCOMPLETE",
          `Availability exceeded the ${MAX_AVAILABILITY_EVENTS}-event safety bound. Narrow the time range.`,
        );
      }
      return [
        {
          calendarId: "shared",
          busy: events
            .filter(({ status }) => status !== "cancelled")
            .map(({ start, end }) => ({ start, end })),
        },
      ];
    },
  };
}

function normalizeCalBooking(item: Record<string, unknown>): CalendarEvent {
  const attendees = Array.isArray(item.attendees) ? item.attendees : [];
  return {
    id: String(item.uid ?? item.id ?? ""),
    calendarId: "bookings",
    title: String(item.title ?? "Booking"),
    description: item.description ? String(item.description) : null,
    location: item.location
      ? JSON.stringify(item.location).slice(0, 500)
      : null,
    start: String(item.start ?? item.startTime ?? ""),
    end: String(item.end ?? item.endTime ?? ""),
    allDay: false,
    status: String(item.status ?? "accepted"),
    organizer:
      Array.isArray(item.hosts) &&
      item.hosts[0] &&
      typeof item.hosts[0] === "object"
        ? String((item.hosts[0] as Record<string, unknown>).email ?? "") || null
        : null,
    attendees: attendees.slice(0, 100).map((entry) => {
      const value = entry as Record<string, unknown>;
      return {
        email: String(value.email ?? ""),
        name: value.name ? String(value.name) : null,
      };
    }),
    version: item.updatedAt ? String(item.updatedAt) : null,
    url: null,
  };
}

export function createCalComAdapter(
  record: IntegrationRecord,
  credentials: CalendarCredentials,
): CalendarAdapter {
  const baseUrl = String(
    record.config.baseUrl || "https://api.cal.com",
  ).replace(/\/$/, "");
  if (!credentials.apiKey)
    throw new CalendarProviderError(
      "CALENDAR_AUTH_REQUIRED",
      "Cal.com API key is missing.",
    );
  async function request<T>(
    path: string,
    version: string,
    init: RequestInit = {},
  ) {
    return jsonRequest<T>(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        "cal-api-version": version,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
  }
  async function list(input: {
    limit: number;
    status?: string;
    cursor?: string;
    from?: string;
    to?: string;
  }) {
    const query = new URLSearchParams({
      limit: String(Math.min(100, input.limit)),
      ...(input.status ? { status: input.status } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.from ? { afterStart: new Date(input.from).toISOString() } : {}),
      ...(input.to ? { beforeEnd: new Date(input.to).toISOString() } : {}),
      ...(input.from || input.to ? { sortStart: "asc" } : {}),
    });
    return request<{
      data?: Array<Record<string, unknown>>;
      pagination?: { nextCursor?: string | null; hasMore?: boolean };
    }>(`/v2/bookings?${query}`, "2026-05-01");
  }
  return {
    async test() {
      await list({ limit: 1 });
      return { accountName: record.name };
    },
    async listCalendars() {
      return [{ id: "bookings", name: record.name, writable: true }];
    },
    async listEvents(input) {
      assertTimeRange(input.from, input.to);
      const start = Date.parse(input.from);
      const end = Date.parse(input.to);
      const result = await list({
        limit: Math.min(100, input.limit),
        cursor: input.pageToken,
        from: input.from,
        to: input.to,
      });
      return {
        events: (result.data ?? [])
          .map(normalizeCalBooking)
          .filter(
            (event) =>
              Date.parse(event.end) > start && Date.parse(event.start) < end,
          ),
        nextPageToken:
          result.pagination?.hasMore === false
            ? null
            : (result.pagination?.nextCursor ?? null),
      };
    },
    async getEvent({ eventId }) {
      const result = await request<{ data: Record<string, unknown> }>(
        `/v2/bookings/${encodeURIComponent(eventId)}`,
        "2024-08-13",
      );
      return normalizeCalBooking(result.data);
    },
    async findAvailability(input) {
      assertTimeRange(input.from, input.to);
      const bookings: CalendarEvent[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_AVAILABILITY_REQUESTS; page += 1) {
        const result = await list({
          limit: 100,
          status: "upcoming",
          cursor,
          from: input.from,
          to: input.to,
        });
        bookings.push(...(result.data ?? []).map(normalizeCalBooking));
        const next = result.pagination?.nextCursor ?? undefined;
        if (result.pagination?.hasMore === true && !next) {
          incompleteAvailability(
            "Cal.com reported more availability pages without a cursor.",
          );
        }
        if (result.pagination?.hasMore === false || !next) {
          cursor = undefined;
          break;
        }
        if (next === cursor) {
          throw new CalendarProviderError(
            "CALENDAR_AVAILABILITY_INCOMPLETE",
            "Cal.com repeated a pagination cursor; availability could not be verified completely.",
          );
        }
        cursor = next;
      }
      if (cursor || bookings.length > MAX_AVAILABILITY_EVENTS) {
        throw new CalendarProviderError(
          "CALENDAR_AVAILABILITY_INCOMPLETE",
          `Availability exceeded the ${MAX_AVAILABILITY_EVENTS}-event safety bound. Narrow the time range.`,
        );
      }
      return [
        {
          calendarId: "bookings",
          busy: bookings
            .filter(
              (event) =>
                Date.parse(event.end) > Date.parse(input.from) &&
                Date.parse(event.start) < Date.parse(input.to),
            )
            .map(({ start, end }) => ({ start, end })),
        },
      ];
    },
    async createEvent(input) {
      assertTimeRange(input.start, input.end);
      if (!record.config.eventTypeId)
        throw new CalendarProviderError(
          "CALENDAR_INVALID_CONFIGURATION",
          "Cal.com event type ID is required to create a booking.",
        );
      if (!input.attendeeEmail || !input.attendeeName)
        throw new CalendarProviderError(
          "CALENDAR_INVALID_INPUT",
          "Cal.com bookings require attendeeName and attendeeEmail.",
        );
      const result = await request<{ data: Record<string, unknown> }>(
        "/v2/bookings",
        "2026-02-25",
        {
          method: "POST",
          body: JSON.stringify({
            start: new Date(input.start).toISOString(),
            eventTypeId: record.config.eventTypeId,
            attendee: {
              name: input.attendeeName,
              email: input.attendeeEmail,
              timeZone: input.timeZone || "UTC",
              language: "en",
            },
            metadata: { source: "slab-agents" },
          }),
        },
      );
      return normalizeCalBooking(result.data);
    },
    async updateEvent(input) {
      if (!input.start)
        throw new CalendarProviderError(
          "CALENDAR_INVALID_INPUT",
          "Cal.com rescheduling requires a new start time.",
        );
      assertDate(input.start, "start");
      const result = await request<{ data: Record<string, unknown> }>(
        `/v2/bookings/${encodeURIComponent(input.id)}/reschedule`,
        "2024-08-13",
        {
          method: "POST",
          body: JSON.stringify({
            start: new Date(input.start).toISOString(),
            reschedulingReason:
              input.reason ?? "Rescheduled by Slab Agent Workspace",
          }),
        },
      );
      return normalizeCalBooking(result.data);
    },
    async cancelEvent({ eventId, reason }) {
      await request(
        `/v2/bookings/${encodeURIComponent(eventId)}/cancel`,
        "2024-08-13",
        {
          method: "POST",
          body: JSON.stringify({
            cancellationReason: reason ?? "Cancelled by Slab Agent Workspace",
          }),
        },
      );
      return { id: eventId, status: "cancelled" };
    },
  };
}
