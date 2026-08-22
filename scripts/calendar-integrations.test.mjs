import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import knexFactory from "knex";

import { calendarInputSchema } from "../lib/integrations/calendar-schema.ts";
import {
  calendarOAuthIdentityChanged,
  clearCalendarOAuthGrant,
} from "../lib/integrations/calendar-contract.ts";
import {
  CalendarProviderError,
  assertTimeRange,
  createCalDavAdapter,
  createCalComAdapter,
  createGoogleCalendarAdapter,
  createIcsAdapter,
  createMicrosoftCalendarAdapter,
} from "../lib/integrations/calendar-providers.ts";

const migrationDirectory = path.resolve("db/migrations");

async function withMigratedDatabase(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "slab-calendar-"));
  const database = knexFactory({
    client: "better-sqlite3",
    connection: { filename: path.join(directory, "workspace.db") },
    useNullAsDefault: true,
    migrations: { directory: migrationDirectory, loadExtensions: [".cjs"] },
    pool: {
      afterCreate(connection, done) {
        connection.pragma("foreign_keys = ON");
        done(null, connection);
      },
    },
  });
  try {
    await database.migrate.latest();
    await run(database);
  } finally {
    await database.destroy();
    await rm(directory, { recursive: true, force: true });
  }
}

function record(overrides = {}) {
  return {
    id: "calendar-test",
    provider: "calendar_ics",
    name: "Team calendar",
    slug: "team_calendar",
    config: {},
    authType: "none",
    enabled: true,
    version: 1,
    credentialsCiphertext: "encrypted",
    status: "connected",
    lastTestedAt: null,
    lastError: null,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    ...overrides,
  };
}

function withFetch(mock, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.fetch = previous;
    });
}

test("calendar OAuth states migrate with expiry and cascade ownership", async () => {
  await withMigratedDatabase(async (database) => {
    const timestamp = new Date().toISOString();
    await database("integrations").insert({
      id: "google-calendar",
      provider: "calendar_google",
      name: "Google Calendar",
      slug: "google_calendar",
      config_json: "{}",
      credentials_ciphertext: "encrypted",
      enabled: 1,
      version: 1,
      status: "not_tested",
      created_at: timestamp,
      updated_at: timestamp,
    });
    await database("integration_oauth_states").insert({
      id: "opaque-state",
      integration_id: "google-calendar",
      provider: "calendar_google",
      verifier_ciphertext: "encrypted-verifier",
      redirect_uri:
        "https://agents.example.com/api/integrations/calendar/google/callback",
      integration_version: 1,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      created_at: timestamp,
    });
    assert.equal(
      Number(
        (
          await database("integration_oauth_states")
            .where({ integration_id: "google-calendar" })
            .count({ count: "*" })
            .first()
        ).count,
      ),
      1,
    );
    assert.equal(
      (
        await database("integration_oauth_states")
          .where({ id: "opaque-state" })
          .first()
      ).integration_version,
      1,
    );
    await database("integrations").where({ id: "google-calendar" }).delete();
    assert.equal(
      Number(
        (
          await database("integration_oauth_states")
            .where({ integration_id: "google-calendar" })
            .count({ count: "*" })
            .first()
        ).count,
      ),
      0,
    );
  });
});

test("calendar run snapshot markers persist even when the capability set is empty", async () => {
  await withMigratedDatabase(async (database) => {
    const timestamp = new Date().toISOString();
    await database("agents").insert({
      id: "agent-calendar",
      name: "Calendar agent",
      slug: "calendar-agent",
      role: "Operator",
      instructions: "Test",
      runtime: "codex",
      model: "default",
      enabled: 1,
      full_access: 0,
      created_at: timestamp,
      updated_at: timestamp,
    });
    await database("runs").insert({
      id: "run-empty-calendar",
      agent_id: "agent-calendar",
      status: "queued",
      runtime: "codex",
      trigger: "manual",
      mode: "task",
      run_instructions: "Test",
    });
    await database("run_integration_snapshot_markers").insert({
      run_id: "run-empty-calendar",
      scope: "calendar",
      captured_at: timestamp,
    });
    assert.deepEqual(
      await database("run_integration_snapshot_markers").where({
        run_id: "run-empty-calendar",
      }),
      [
        {
          run_id: "run-empty-calendar",
          scope: "calendar",
          captured_at: timestamp,
        },
      ],
    );
  });
});

test("OAuth identity changes invalidate the previous account grant", () => {
  assert.equal(
    calendarOAuthIdentityChanged({
      provider: "calendar_google",
      currentClientId: "old-client",
      nextClientId: "new-client",
      replacesClientSecret: true,
    }),
    true,
  );
  assert.equal(
    calendarOAuthIdentityChanged({
      provider: "calendar_google",
      currentClientId: "same-client",
      replacesClientSecret: false,
    }),
    false,
  );
  assert.equal(
    calendarOAuthIdentityChanged({
      provider: "calendar_microsoft",
      currentClientId: "same-client",
      currentTenant: "old-tenant",
      nextTenant: "new-tenant",
      replacesClientSecret: false,
    }),
    true,
  );
  assert.deepEqual(
    clearCalendarOAuthGrant({
      clientId: "client",
      clientSecret: "secret",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    }),
    { clientId: "client", clientSecret: "secret" },
  );
});

test("calendar API schema rejects unsupported providers and oversized secrets", () => {
  assert.equal(
    calendarInputSchema.safeParse({ provider: "calendar_google", name: "Work" })
      .success,
    true,
  );
  assert.equal(
    calendarInputSchema.safeParse({ provider: "calendar_proton", name: "Work" })
      .success,
    false,
  );
  assert.equal(
    calendarInputSchema.safeParse({
      provider: "calendar_calcom",
      name: "Cal.com",
      apiKey: "x".repeat(2001),
    }).success,
    false,
  );
});

test("calendar ranges are bounded and ordered", () => {
  assert.doesNotThrow(() =>
    assertTimeRange("2026-08-01T00:00:00Z", "2026-08-02T00:00:00Z"),
  );
  assert.throws(
    () => assertTimeRange("2026-08-02", "2026-08-01"),
    (error) =>
      error instanceof CalendarProviderError &&
      error.code === "CALENDAR_INVALID_INPUT",
  );
  assert.throws(
    () => assertTimeRange("2025-01-01", "2026-08-01"),
    /limited to 366 days/,
  );
});

test("shared ICS is read-only, bounded, and normalizes events", async () => {
  const calendar = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:event-1\r\nSUMMARY:Pipeline review\r\nDTSTART:20260824T090000Z\r\nDTEND:20260824T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  await withFetch(
    async (url, init) => {
      assert.equal(String(url), "https://calendar.example.com/private.ics");
      assert.equal(init.redirect, "manual");
      return new Response(calendar, {
        status: 200,
        headers: { "Content-Type": "text/calendar" },
      });
    },
    async () => {
      const adapter = createIcsAdapter(record(), {
        feedUrl: "https://calendar.example.com/private.ics",
      });
      assert.equal(adapter.createEvent, undefined);
      const result = await adapter.listEvents({
        from: "2026-08-24T00:00:00Z",
        to: "2026-08-25T00:00:00Z",
        limit: 10,
      });
      assert.deepEqual(
        result.events.map(({ id, title }) => ({ id, title })),
        [{ id: "event-1", title: "Pipeline review" }],
      );
      const availability = await adapter.findAvailability({
        from: "2026-08-24T00:00:00Z",
        to: "2026-08-25T00:00:00Z",
      });
      assert.equal(availability[0].busy.length, 1);
    },
  );
});

test("shared ICS refuses to claim complete availability above its safety bound", async () => {
  const events = Array.from(
    { length: 1001 },
    (_, index) =>
      `BEGIN:VEVENT\r\nUID:event-${index}\r\nSUMMARY:Busy\r\nDTSTART:20260824T090000Z\r\nDTEND:20260824T100000Z\r\nEND:VEVENT\r\n`,
  ).join("");
  const calendar = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}END:VCALENDAR\r\n`;
  await withFetch(
    async () => new Response(calendar, { status: 200 }),
    async () => {
      const adapter = createIcsAdapter(record(), {
        feedUrl: "https://calendar.example.com/private.ics",
      });
      await assert.rejects(
        () =>
          adapter.findAvailability({
            from: "2026-08-24T00:00:00Z",
            to: "2026-08-25T00:00:00Z",
          }),
        (error) =>
          error instanceof CalendarProviderError &&
          error.code === "CALENDAR_AVAILABILITY_INCOMPLETE",
      );
      assert.equal(
        (await adapter.getEvent({ eventId: "event-1000" })).id,
        "event-1000",
      );
    },
  );
});

test("shared ICS refuses incomplete recurrence-based availability", async () => {
  const calendar = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:weekly-1\r\nSUMMARY:Weekly review\r\nDTSTART:20260824T090000Z\r\nDTEND:20260824T100000Z\r\nRRULE:FREQ=WEEKLY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  await withFetch(
    async () => new Response(calendar, { status: 200 }),
    async () => {
      const adapter = createIcsAdapter(record(), {
        feedUrl: "https://calendar.example.com/private.ics",
      });
      await assert.rejects(
        () =>
          adapter.findAvailability({
            from: "2026-08-24T00:00:00Z",
            to: "2026-09-30T00:00:00Z",
          }),
        (error) =>
          error instanceof CalendarProviderError &&
          error.code === "CALENDAR_AVAILABILITY_INCOMPLETE",
      );
    },
  );
});

test("calendar provider response limits reject before buffering", async () => {
  await withFetch(
    async () =>
      new Response("small", {
        status: 200,
        headers: { "Content-Length": String(1024 * 1024 + 1) },
      }),
    async () => {
      const adapter = createIcsAdapter(record(), {
        feedUrl: "https://calendar.example.com/private.ics",
      });
      await assert.rejects(
        () => adapter.test(),
        (error) =>
          error instanceof CalendarProviderError &&
          error.code === "CALENDAR_RESPONSE_TOO_LARGE",
      );
    },
  );
});

test("Google tools normalize data and never expose an echoed access token", async () => {
  const credentials = {
    accessToken: "calendar-access-secret",
    accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
  };
  await withFetch(
    async (url, init) => {
      assert.equal(init.headers.Authorization, "Bearer calendar-access-secret");
      assert.equal(init.redirect, "manual");
      if (String(url).includes("calendarList")) {
        return Response.json({
          items: [
            {
              id: "primary@example.com",
              summary: "Primary",
              primary: true,
              accessRole: "owner",
            },
          ],
        });
      }
      return Response.json(
        { error: { message: "Bearer calendar-access-secret is invalid" } },
        { status: 401 },
      );
    },
    async () => {
      const adapter = createGoogleCalendarAdapter(credentials, () => {});
      assert.equal((await adapter.listCalendars())[0].writable, true);
      await assert.rejects(
        () => adapter.getEvent({ eventId: "event-1" }),
        (error) =>
          error instanceof CalendarProviderError &&
          error.code === "CALENDAR_AUTH_FAILED" &&
          !error.message.includes("calendar-access-secret"),
      );
    },
  );
});

test("Microsoft availability derives from scoped events and rejects foreign page links", async () => {
  const calls = [];
  await withFetch(
    async (url, init) => {
      calls.push({ url: String(url), body: init.body });
      return Response.json({
        value: [
          {
            id: "event-1",
            subject: "Busy",
            start: { dateTime: "2026-08-24T09:00:00Z" },
            end: { dateTime: "2026-08-24T10:00:00Z" },
          },
        ],
      });
    },
    async () => {
      const adapter = createMicrosoftCalendarAdapter(
        {
          accessToken: "graph-secret",
          accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
        },
        "common",
        () => {},
      );
      const availability = await adapter.findAvailability({
        from: "2026-08-24T00:00:00Z",
        to: "2026-08-25T00:00:00Z",
      });
      assert.equal(availability[0].calendarId, "primary");
      assert.equal(availability[0].busy.length, 1);
      assert.match(calls[0].url, /\/me\/calendarView/);
      await assert.rejects(
        () =>
          adapter.listEvents({
            from: "2026-08-24T00:00:00Z",
            to: "2026-08-25T00:00:00Z",
            limit: 10,
            pageToken: "https://evil.example.com/steal",
          }),
        /page token is invalid/,
      );
    },
  );
});

test("Microsoft availability consumes every bounded page", async () => {
  let page = 0;
  await withFetch(
    async () => {
      page += 1;
      return Response.json({
        value: [
          {
            id: `event-${page}`,
            subject: "Busy",
            start: { dateTime: `2026-08-24T0${page}:00:00`, timeZone: "UTC" },
            end: { dateTime: `2026-08-24T0${page}:30:00`, timeZone: "UTC" },
          },
        ],
        ...(page === 1
          ? {
              "@odata.nextLink":
                "https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=next",
            }
          : {}),
      });
    },
    async () => {
      const adapter = createMicrosoftCalendarAdapter(
        {
          accessToken: "graph-secret",
          accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
        },
        "common",
        () => {},
      );
      const availability = await adapter.findAvailability({
        from: "2026-08-24T00:00:00Z",
        to: "2026-08-25T00:00:00Z",
      });
      assert.equal(page, 2);
      assert.equal(availability[0].busy.length, 2);
      assert.equal(availability[0].busy[0].start, "2026-08-24T01:00:00.000Z");
    },
  );
});

test("CalDAV discovery cannot escape the configured origin", async () => {
  const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>https://evil.example.com/calendar/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Evil</d:displayname></d:prop></d:propstat></d:response></d:multistatus>`;
  await withFetch(
    async () => new Response(xml, { status: 207 }),
    async () => {
      const adapter = createCalDavAdapter(
        record({
          provider: "calendar_caldav",
          config: { baseUrl: "https://dav.example.com/calendars/user/" },
        }),
        { username: "user", password: "app-password" },
      );
      await assert.rejects(
        () => adapter.listCalendars(),
        (error) =>
          error instanceof CalendarProviderError &&
          error.code === "CALENDAR_INVALID_INPUT",
      );
    },
  );
});

test("CalDAV all-day writes use DATE values and preserve the collection slash", async () => {
  let requestUrl = "";
  let body = "";
  await withFetch(
    async (url, init) => {
      requestUrl = String(url);
      body = String(init.body ?? "");
      return new Response("", { status: 201, headers: { ETag: '"v1"' } });
    },
    async () => {
      const adapter = createCalDavAdapter(
        record({
          provider: "calendar_caldav",
          config: { baseUrl: "https://dav.example.com/calendars/user/" },
        }),
        { username: "user", password: "app-password" },
      );
      const event = await adapter.createEvent({
        title: "Company holiday",
        start: "2026-08-24",
        end: "2026-08-25",
        allDay: true,
      });
      assert.match(
        requestUrl,
        /^https:\/\/dav\.example\.com\/calendars\/user\//,
      );
      assert.match(body, /DTSTART;VALUE=DATE:20260824/);
      assert.match(body, /DTEND;VALUE=DATE:20260825/);
      assert.equal(event.allDay, true);
    },
  );
});

test("CalDAV update preserves recurrence and alarms and always uses the latest ETag", async () => {
  const current = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:event-1\r\nSUMMARY:Old title\r\nDTSTART:20260824T090000Z\r\nDTEND:20260824T100000Z\r\nRRULE:FREQ=WEEKLY\r\nBEGIN:VALARM\r\nTRIGGER:-PT15M\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  let putBody = "";
  let ifMatch = "";
  await withFetch(
    async (_url, init) => {
      if (init.method === "GET") {
        return new Response(current, {
          status: 200,
          headers: { ETag: '"v7"' },
        });
      }
      putBody = String(init.body ?? "");
      ifMatch = init.headers["If-Match"];
      return new Response(null, { status: 204, headers: { ETag: '"v8"' } });
    },
    async () => {
      const adapter = createCalDavAdapter(
        record({
          provider: "calendar_caldav",
          config: { baseUrl: "https://dav.example.com/calendars/user/" },
        }),
        { username: "user", password: "app-password" },
      );
      const event = await adapter.updateEvent({
        id: "https://dav.example.com/calendars/user/event-1.ics",
        title: "New title",
      });
      assert.equal(ifMatch, '"v7"');
      assert.match(putBody, /SUMMARY:New title/);
      assert.match(putBody, /RRULE:FREQ=WEEKLY/);
      assert.match(putBody, /BEGIN:VALARM/);
      assert.equal(event.version, '"v8"');
    },
  );
});

test("Cal.com uses bounded server-side period filters and opaque pagination", async () => {
  const calls = [];
  await withFetch(
    async (url, init) => {
      calls.push({ url: new URL(String(url)), init });
      return Response.json({
        data: [
          {
            uid: "booking-1",
            title: "Discovery",
            start: "2026-08-24T09:00:00Z",
            end: "2026-08-24T09:30:00Z",
            status: "accepted",
          },
        ],
        pagination: { hasMore: true, nextCursor: "next-opaque" },
      });
    },
    async () => {
      const adapter = createCalComAdapter(
        record({
          provider: "calendar_calcom",
          config: { baseUrl: "https://api.cal.com", eventTypeId: 123 },
        }),
        { apiKey: "cal_secret" },
      );
      const result = await adapter.listEvents({
        from: "2026-08-24T00:00:00Z",
        to: "2026-08-25T00:00:00Z",
        limit: 25,
        pageToken: "cursor-one",
      });
      assert.equal(result.nextPageToken, "next-opaque");
      assert.equal(calls[0].url.searchParams.get("limit"), "25");
      assert.equal(calls[0].url.searchParams.get("cursor"), "cursor-one");
      assert.equal(
        calls[0].url.searchParams.get("afterStart"),
        "2026-08-24T00:00:00.000Z",
      );
      assert.equal(calls[0].init.headers.Authorization, "Bearer cal_secret");
      assert.equal(calls[0].init.headers["cal-api-version"], "2026-05-01");
    },
  );
});

test("Cal.com availability consumes opaque cursors", async () => {
  let page = 0;
  await withFetch(
    async () => {
      page += 1;
      return Response.json({
        data: [
          {
            uid: `booking-${page}`,
            title: "Busy",
            start: `2026-08-24T0${page}:00:00Z`,
            end: `2026-08-24T0${page}:30:00Z`,
            status: "accepted",
          },
        ],
        pagination:
          page === 1
            ? { hasMore: true, nextCursor: "next-opaque" }
            : { hasMore: false },
      });
    },
    async () => {
      const adapter = createCalComAdapter(
        record({
          provider: "calendar_calcom",
          config: { baseUrl: "https://api.cal.com" },
        }),
        { apiKey: "cal_secret" },
      );
      const availability = await adapter.findAvailability({
        from: "2026-08-24T00:00:00Z",
        to: "2026-08-25T00:00:00Z",
      });
      assert.equal(page, 2);
      assert.equal(availability[0].busy.length, 2);
    },
  );
});

test("Cal.com availability fails closed when pagination has no usable cursor", async () => {
  await withFetch(
    async () =>
      Response.json({
        data: [
          {
            uid: "booking-1",
            title: "Busy",
            start: "2026-08-24T09:00:00Z",
            end: "2026-08-24T09:30:00Z",
          },
        ],
        pagination: { hasMore: true },
      }),
    async () => {
      const adapter = createCalComAdapter(
        record({
          provider: "calendar_calcom",
          config: { baseUrl: "https://api.cal.com" },
        }),
        { apiKey: "cal_secret" },
      );
      await assert.rejects(
        () =>
          adapter.findAvailability({
            from: "2026-08-24T00:00:00Z",
            to: "2026-08-25T00:00:00Z",
          }),
        (error) =>
          error instanceof CalendarProviderError &&
          error.code === "CALENDAR_AVAILABILITY_INCOMPLETE",
      );
    },
  );
});
