import assert from "node:assert/strict";
import test from "node:test";

import { canReuseHttpCredential } from "../lib/integrations/http-contract.ts";

test("stored credentials are reusable only for the same authentication identity", () => {
  const previous = {
    baseUrl: "https://api.example.com/v1",
    authType: "api_key_header",
    authHeaderName: "X-API-Key",
  };

  assert.equal(
    canReuseHttpCredential(previous, {
      ...previous,
      baseUrl: "https://api.example.com/v2",
      authHeaderName: "x-api-key",
    }),
    true,
  );
  assert.equal(
    canReuseHttpCredential(previous, {
      ...previous,
      baseUrl: "https://other.example.com/v1",
    }),
    false,
  );
  assert.equal(
    canReuseHttpCredential(previous, {
      ...previous,
      authType: "bearer",
    }),
    false,
  );
  assert.equal(
    canReuseHttpCredential(previous, {
      ...previous,
      authHeaderName: "X-Other-Key",
    }),
    false,
  );
});
