import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { z } from "zod";

register("./test-alias-loader.mjs", import.meta.url);

const [
  apiModule,
  clientModule,
  integrationErrors,
  operationalErrors,
  emailClient,
] =
  await Promise.all([
    import("../lib/api.ts"),
    import("../lib/client-api.ts"),
    import("../lib/integrations/errors.ts"),
    import("../lib/operational-error.ts"),
    import("../lib/integrations/email-client.ts"),
  ]);
const { apiError, notFound } = apiModule;
const { api, ApiClientError } = clientModule;
const { IntegrationConfigurationError, IntegrationVersionConflictError } =
  integrationErrors;
const { OperationalError } = operationalErrors;

test("API errors use one structured envelope without leaking unknown errors", async () => {
  const missing = apiError(notFound("Agent not found"));
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), {
    error: { code: "NOT_FOUND", message: "Agent not found" },
  });

  let validationError;
  try {
    z.object({ name: z.string().min(2) }).parse({ name: "" });
  } catch (error) {
    validationError = error;
  }
  const invalid = apiError(validationError);
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, "INVALID_REQUEST");

  const configuration = apiError(
    new IntegrationConfigurationError("Invalid operation path"),
  );
  assert.equal(configuration.status, 400);
  assert.equal(
    (await configuration.json()).error.code,
    "INVALID_INTEGRATION_CONFIGURATION",
  );
  const conflict = apiError(new IntegrationVersionConflictError());
  assert.equal(conflict.status, 409);

  const operational = apiError(
    new OperationalError("OAuth client ID and client secret are required."),
  );
  assert.equal(operational.status, 400);
  assert.deepEqual(await operational.json(), {
    error: {
      code: "OPERATION_REJECTED",
      message: "OAuth client ID and client secret are required.",
    },
  });
  for (const serviceUrl of [
    "ftp://email.example.test",
    "https://email.example.test?token=hidden",
  ]) {
    let emailConfigurationError;
    try {
      emailClient.normalizeEmailServiceUrl(serviceUrl);
    } catch (error) {
      emailConfigurationError = error;
    }
    const response = apiError(emailConfigurationError);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "OPERATION_REJECTED");
  }

  const upstream = apiError(
    Object.assign(new Error("Remote validation failed"), {
      name: "McpToolError",
      code: "UPSTREAM_REJECTED",
    }),
  );
  assert.equal(upstream.status, 502);
  assert.deepEqual(await upstream.json(), {
    error: {
      code: "UPSTREAM_REJECTED",
      message: "Remote validation failed",
    },
  });

  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    for (const message of [
      "database password: secret-value",
      "upstream returned sk-live-SECRET",
      "request failed with Bearer abc123",
      "harmless-looking internal implementation detail",
    ]) {
      const internal = apiError(new Error(message));
      assert.equal(internal.status, 500);
      assert.deepEqual(await internal.json(), {
        error: { code: "INTERNAL_ERROR", message: "Request failed" },
      });
    }
  } finally {
    console.error = originalConsoleError;
  }
});

test("the browser client reads structured and legacy error envelopes", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json(
        {
          error: {
            code: "VERSION_CONFLICT",
            message: "Issue changed",
            details: { currentVersion: 9 },
          },
        },
        { status: 409 },
      );
    await assert.rejects(
      api("/api/work"),
      (error) =>
        error instanceof ApiClientError &&
        error.status === 409 &&
        error.code === "VERSION_CONFLICT" &&
        error.details?.currentVersion === 9,
    );

    globalThis.fetch = async () =>
      Response.json({ error: "Legacy failure" }, { status: 400 });
    await assert.rejects(api("/api/legacy"), /Legacy failure/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
