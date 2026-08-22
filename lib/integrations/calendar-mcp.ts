import "server-only";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

import { CalendarProviderError } from "@/lib/integrations/calendar-providers";
import { getRunCalendarRuntimeAccess } from "@/lib/integrations/calendar-service";

const activeCalendarCalls = new Map<string, number>();
const MAX_CONCURRENT_CALENDAR_CALLS = 4;

function resolveToken(request: Request) {
  return (
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    request.headers.get("x-api-key") ||
    ""
  );
}

function unauthorizedResponse() {
  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    },
    { status: 401 },
  );
}

function safeResult(value: unknown) {
  const text = JSON.stringify(value, null, 2) ?? "null";
  if (text.length > 100_000) {
    throw new CalendarProviderError(
      "CALENDAR_RESPONSE_TOO_LARGE",
      "Calendar result is too large. Use a narrower time range.",
    );
  }
  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
  };
}

function asToolError(error: unknown) {
  if (error instanceof CalendarProviderError) {
    return new Error(
      JSON.stringify({
        error: {
          code: error.code,
          message: error.message,
          ...(error.status ? { status: error.status } : {}),
        },
      }),
    );
  }
  return new Error(
    JSON.stringify({
      error: {
        code: "CALENDAR_OPERATION_FAILED",
        message:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "Calendar operation failed.",
      },
    }),
  );
}

const timeRange = {
  from: z
    .string()
    .min(4)
    .max(64)
    .describe("Inclusive ISO start date or timestamp"),
  to: z.string().min(4).max(64).describe("Exclusive ISO end date or timestamp"),
};

const attendeeSchema = z.object({
  email: z.string().email().max(320),
  name: z.string().trim().min(1).max(160).optional(),
});

const eventFields = {
  calendarId: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .optional()
    .describe("Calendar ID returned by calendar_list_calendars"),
  title: z.string().trim().min(1).max(500),
  description: z.string().max(10_000).optional(),
  location: z.string().max(500).optional(),
  start: z.string().min(4).max(64),
  end: z.string().min(4).max(64),
  timeZone: z.string().trim().min(1).max(100).optional(),
  allDay: z.boolean().optional(),
  attendees: z.array(attendeeSchema).max(100).optional(),
  attendeeName: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .optional()
    .describe("Cal.com booking attendee name"),
  attendeeEmail: z
    .string()
    .email()
    .max(320)
    .optional()
    .describe("Cal.com booking attendee email"),
};

export async function handleCalendarMcpRequest(
  request: Request,
  integrationId: string,
  runId: string,
) {
  const access = getRunCalendarRuntimeAccess(
    integrationId,
    runId,
    resolveToken(request),
  );
  if (access.status === "stale") {
    return Response.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32009,
          message:
            "CAPABILITY_VERSION_CHANGED: calendar configuration changed after this run started.",
          data: {
            expectedVersion: access.integrationVersion,
            currentVersion: access.currentVersion,
          },
        },
        id: null,
      },
      { status: 409 },
    );
  }
  if (access.status !== "ok") return unauthorizedResponse();

  const allowed = new Set(access.allowedTools);
  const adapter = access.adapter;
  async function calendarCall<T>(call: () => Promise<T>) {
    const active = activeCalendarCalls.get(integrationId) ?? 0;
    if (active >= MAX_CONCURRENT_CALENDAR_CALLS) {
      throw asToolError(
        new CalendarProviderError(
          "CALENDAR_BUSY",
          "This calendar integration already has too many active requests. Try again shortly.",
        ),
      );
    }
    activeCalendarCalls.set(integrationId, active + 1);
    try {
      return safeResult(await call());
    } catch (error) {
      throw asToolError(error);
    } finally {
      const remaining = (activeCalendarCalls.get(integrationId) ?? 1) - 1;
      if (remaining > 0) activeCalendarCalls.set(integrationId, remaining);
      else activeCalendarCalls.delete(integrationId);
    }
  }
  const server = new McpServer({
    name: `calendar_${access.record.slug}`,
    version: "0.1.0",
  });
  const readAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  };

  if (allowed.has("calendar_list_calendars")) {
    server.registerTool(
      "calendar_list_calendars",
      {
        title: "List calendars",
        description:
          "List calendar metadata available through this scoped account. Does not return event bodies.",
        inputSchema: {},
        annotations: readAnnotations,
      },
      async () => calendarCall(() => adapter.listCalendars()),
    );
  }

  if (allowed.has("calendar_list_events")) {
    server.registerTool(
      "calendar_list_events",
      {
        title: "List calendar events",
        description:
          "List a bounded set of events for an explicit time range. Use calendar_get_event for one exact event.",
        inputSchema: {
          calendarId: z.string().trim().min(1).max(2048).optional(),
          ...timeRange,
          limit: z.number().int().min(1).max(100).default(50),
          pageToken: z.string().max(4096).optional(),
        },
        annotations: readAnnotations,
      },
      async (input) => calendarCall(() => adapter.listEvents(input)),
    );
  }

  if (allowed.has("calendar_get_event")) {
    server.registerTool(
      "calendar_get_event",
      {
        title: "Get calendar event",
        description:
          "Read one event using the provider event ID returned by calendar_list_events.",
        inputSchema: {
          calendarId: z.string().trim().min(1).max(2048).optional(),
          eventId: z.string().trim().min(1).max(4096),
        },
        annotations: readAnnotations,
      },
      async (input) => calendarCall(() => adapter.getEvent(input)),
    );
  }

  if (allowed.has("calendar_find_availability")) {
    server.registerTool(
      "calendar_find_availability",
      {
        title: "Find calendar availability",
        description:
          "Return busy intervals for an explicit time range. It does not create holds or events.",
        inputSchema: {
          calendarIds: z
            .array(z.string().trim().min(1).max(2048))
            .max(3)
            .optional(),
          ...timeRange,
        },
        annotations: readAnnotations,
      },
      async (input) => calendarCall(() => adapter.findAvailability(input)),
    );
  }

  if (allowed.has("calendar_create_event") && adapter.createEvent) {
    server.registerTool(
      "calendar_create_event",
      {
        title: "Create calendar event",
        description:
          "Create an event or booking in this scoped account. Use only after confirming date, time zone, calendar, and attendees.",
        inputSchema: eventFields,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      },
      async (input) => calendarCall(() => adapter.createEvent!(input)),
    );
  }

  if (allowed.has("calendar_update_event") && adapter.updateEvent) {
    server.registerTool(
      "calendar_update_event",
      {
        title: "Update calendar event",
        description:
          "Update or reschedule one event. Pass the latest version from calendar_get_event when available.",
        inputSchema: {
          id: z.string().trim().min(1).max(4096),
          version: z.string().max(500).optional(),
          reason: z.string().max(1000).optional(),
          calendarId: eventFields.calendarId,
          title: eventFields.title.optional(),
          description: eventFields.description,
          location: eventFields.location,
          start: eventFields.start.optional(),
          end: eventFields.end.optional(),
          timeZone: eventFields.timeZone,
          allDay: eventFields.allDay,
          attendees: eventFields.attendees,
          attendeeName: eventFields.attendeeName,
          attendeeEmail: eventFields.attendeeEmail,
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      },
      async (input) => calendarCall(() => adapter.updateEvent!(input)),
    );
  }

  if (allowed.has("calendar_cancel_event") && adapter.cancelEvent) {
    server.registerTool(
      "calendar_cancel_event",
      {
        title: "Cancel calendar event",
        description:
          "Cancel or delete one event. Pass the latest version when the provider supplies one.",
        inputSchema: {
          calendarId: z.string().trim().min(1).max(2048).optional(),
          eventId: z.string().trim().min(1).max(4096),
          version: z.string().max(500).optional(),
          reason: z.string().max(1000).optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
        },
      },
      async (input) => calendarCall(() => adapter.cancelEvent!(input)),
    );
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}
