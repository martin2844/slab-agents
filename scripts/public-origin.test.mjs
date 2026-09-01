import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  configuredPublicOrigin,
  emailSettingsRedirect,
  forwardedRequestOrigin,
  publicRequestOrigin,
} from "../lib/request-origin.ts";
import {
  GOOGLE_OAUTH_CALLBACK_PATH,
  googleOAuthCallbackUrl,
  googleOAuthDestinationForProvider,
} from "../lib/integrations/google-oauth-contract.ts";

const read = (filename) =>
  readFile(new URL(`../${filename}`, import.meta.url), "utf8");

test("configured public URL wins over the container request origin", () => {
  const request = new Request(
    "https://0.0.0.0:3009/api/integrations/email/gmail/connect",
  );

  assert.equal(
    publicRequestOrigin(request, "https://agents.c5h.dev"),
    "https://agents.c5h.dev",
  );
  assert.equal(
    configuredPublicOrigin("https://agents.c5h.dev"),
    "https://agents.c5h.dev",
  );
});

test("public request origin falls back to the request URL for local development", () => {
  const request = new Request(
    "http://127.0.0.1:3009/api/integrations/email/gmail/connect",
  );

  assert.equal(publicRequestOrigin(request, ""), "http://127.0.0.1:3009");
});

test("forwarded request headers produce the browser-visible origin", () => {
  assert.equal(
    forwardedRequestOrigin(
      new Headers({
        host: "slab-agents:3009",
        "x-forwarded-host": "agents.c5h.dev",
        "x-forwarded-proto": "https",
      }),
    ),
    "https://agents.c5h.dev",
  );
  assert.equal(
    forwardedRequestOrigin(new Headers({ host: "127.0.0.1:3009" })),
    "http://127.0.0.1:3009",
  );
});

test("forwarded request origin rejects unsupported protocols", () => {
  assert.equal(
    forwardedRequestOrigin(
      new Headers({
        host: "agents.c5h.dev",
        "x-forwarded-proto": "javascript",
      }),
    ),
    "",
  );
});

test("public URL rejects non-HTTP schemes and non-origin paths", () => {
  const request = new Request("http://127.0.0.1:3009");

  assert.throws(
    () => publicRequestOrigin(request, "javascript:alert(1)"),
    /http or https/i,
  );
  assert.throws(
    () => publicRequestOrigin(request, "https://agents.c5h.dev/base"),
    /origin without a path/i,
  );
});

test("Gmail and Microsoft OAuth handlers use the public origin resolver", async () => {
  const [connectRoute, callbackRoute, microsoftConnect, microsoftCallback] =
    await Promise.all([
      read("app/api/integrations/email/gmail/connect/route.ts"),
      read("app/api/integrations/email/google/callback/route.ts"),
      read("app/api/integrations/email/microsoft/connect/route.ts"),
      read("app/api/integrations/email/microsoft/callback/route.ts"),
    ]);

  assert.match(connectRoute, /publicRequestOrigin\(request\)/);
  assert.match(connectRoute, /GOOGLE_OAUTH_CALLBACK_PATH/);
  assert.match(callbackRoute, /emailSettingsRedirect\(request/);
  assert.match(microsoftConnect, /publicRequestOrigin\(request\)/);
  assert.match(microsoftCallback, /emailSettingsRedirect\(request/);
});

test("Gmail OAuth returns to Email settings and preserves the result", () => {
  const request = new Request(
    "https://0.0.0.0:3009/api/integrations/google/callback",
  );

  assert.equal(
    emailSettingsRedirect(request, "connected", "https://agents.c5h.dev").href,
    "https://agents.c5h.dev/settings?tab=email&email=connected",
  );
});

test("all Google integrations share one public callback and route by OAuth state owner", async () => {
  assert.equal(GOOGLE_OAUTH_CALLBACK_PATH, "/api/integrations/google/callback");
  assert.equal(
    googleOAuthCallbackUrl("https://agents.c5h.dev"),
    "https://agents.c5h.dev/api/integrations/google/callback",
  );
  assert.equal(googleOAuthDestinationForProvider("google_analytics"), "integrations");
  assert.equal(
    googleOAuthDestinationForProvider("google_search_console"),
    "integrations",
  );
  assert.equal(googleOAuthDestinationForProvider("calendar_google"), "calendar");
  assert.equal(googleOAuthDestinationForProvider(null), "email");

  const [callbackRoute, callbackService, dataConnect, calendarConnect] =
    await Promise.all([
      read("app/api/integrations/google/callback/route.ts"),
      read("lib/integrations/google-oauth-service.ts"),
      read("app/api/integrations/google-data/[id]/oauth/route.ts"),
      read("app/api/integrations/calendar/[id]/oauth/route.ts"),
    ]);
  assert.match(callbackRoute, /completeGoogleOAuthCallback/);
  assert.match(callbackService, /finishGoogleDataOAuth/);
  assert.match(callbackService, /finishGoogleCalendarOAuth/);
  assert.match(callbackService, /completeGmailConnection/);
  assert.match(dataConnect, /GOOGLE_OAUTH_CALLBACK_PATH/);
  assert.match(calendarConnect, /GOOGLE_OAUTH_CALLBACK_PATH/);
});

test("calendar OAuth uses the configured public origin for authorization and callbacks", async () => {
  const [connect, googleCallback, microsoftCallback, settingsPage, editor] =
    await Promise.all([
      read("app/api/integrations/calendar/[id]/oauth/route.ts"),
      read("app/api/integrations/calendar/google/callback/route.ts"),
      read("app/api/integrations/calendar/microsoft/callback/route.ts"),
      read("app/settings/page.tsx"),
      read("components/calendar-integration-editor.tsx"),
    ]);

  assert.match(connect, /publicRequestOrigin\(request\)/);
  assert.match(googleCallback, /publicRequestOrigin\(request\)/);
  assert.match(microsoftCallback, /publicRequestOrigin\(request\)/);
  assert.match(googleCallback, /tab", "calendar"/);
  assert.match(microsoftCallback, /tab", "calendar"/);
  assert.match(
    settingsPage,
    /calendarCallbackOrigin={configuredPublicOrigin\(\)}/,
  );
  assert.match(settingsPage, /initialCalendarResult/);
  assert.match(editor, /Calendar authorization failed or was cancelled/);
  assert.match(editor, /saved\.status === "connected"/);
  const settingsView = await read("components/settings-view.tsx");
  assert.match(settingsView, /setCalendarResult\(null\)/);
  assert.match(settingsView, /clearCallbackResult\("calendar"\)/);
});
