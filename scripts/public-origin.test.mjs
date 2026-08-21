import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  emailSettingsRedirect,
  publicRequestOrigin,
} from "../lib/request-origin.ts";

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
});

test("public request origin falls back to the request URL for local development", () => {
  const request = new Request(
    "http://127.0.0.1:3009/api/integrations/email/gmail/connect",
  );

  assert.equal(publicRequestOrigin(request, ""), "http://127.0.0.1:3009");
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
  const [connectRoute, callbackRoute, microsoftConnect, microsoftCallback] = await Promise.all([
    read("app/api/integrations/email/gmail/connect/route.ts"),
    read("app/api/integrations/email/google/callback/route.ts"),
    read("app/api/integrations/email/microsoft/connect/route.ts"),
    read("app/api/integrations/email/microsoft/callback/route.ts"),
  ]);

  assert.match(connectRoute, /publicRequestOrigin\(request\)/);
  assert.match(callbackRoute, /emailSettingsRedirect\(request/);
  assert.match(microsoftConnect, /publicRequestOrigin\(request\)/);
  assert.match(microsoftCallback, /emailSettingsRedirect\(request/);
});

test("Gmail OAuth returns to Email settings and preserves the result", () => {
  const request = new Request(
    "https://0.0.0.0:3009/api/integrations/email/google/callback",
  );

  assert.equal(
    emailSettingsRedirect(request, "connected", "https://agents.c5h.dev")
      .href,
    "https://agents.c5h.dev/settings?tab=email&email=connected",
  );
});
