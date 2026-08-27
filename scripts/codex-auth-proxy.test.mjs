import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";
import knexFactory from "knex";

register("./test-alias-loader.mjs", import.meta.url);

test("Codex authentication proxy validates and minimizes Runner data", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "slab-codex-auth-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "workspace.db");
  const migrations = knexFactory({
    client: "better-sqlite3",
    connection: { filename },
    useNullAsDefault: true,
    migrations: {
      directory: path.resolve("db/migrations"),
      loadExtensions: [".cjs"],
    },
  });
  await migrations.migrate.latest();
  await migrations.destroy();

  process.env.SLAB_WORKSPACE_DB = filename;
  process.env.RUNNER_URL = "http://runner.internal:6990/";
  process.env.RUNNER_TOKEN = "runner-auth-token-never-returned";

  const [runner, { codexAuthApiError }, { RunnerRequestError }] =
    await Promise.all([
      import("../lib/runner.ts"),
      import("../lib/codex-auth-api.ts"),
      import("../lib/runner-errors.ts"),
    ]);
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({
      data: {
        status: "authenticated",
        authMode: "chatgpt",
        email: "operator@example.test",
        planType: "plus",
        login: null,
        accessToken: "must-not-cross-browser-boundary",
      },
    });
  };
  assert.deepEqual(await runner.getCodexAuthStatus(fetcher), {
    status: "authenticated",
    authMode: "chatgpt",
    email: "operator@example.test",
    planType: "plus",
    login: null,
  });
  assert.equal(calls[0].url, "http://runner.internal:6990/auth/codex");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(
    calls[0].init.headers.Authorization,
    "Bearer runner-auth-token-never-returned",
  );
  assert.equal(calls[0].init.cache, "no-store");

  const login = {
    loginId: "login_safe-123",
    verificationUrl: "https://auth.openai.com/codex/device",
    userCode: "CODE-1234",
    status: "pending",
    expiresAt: "2026-08-27T12:15:00.000Z",
    refreshToken: "must-also-be-dropped",
  };
  const started = await runner.startCodexDeviceLogin(async (url, init) => {
    assert.equal(
      String(url),
      "http://runner.internal:6990/auth/codex/device-login",
    );
    assert.equal(init.method, "POST");
    return Response.json({ data: login }, { status: 202 });
  });
  assert.deepEqual(started, {
    loginId: login.loginId,
    verificationUrl: login.verificationUrl,
    userCode: login.userCode,
    status: login.status,
    expiresAt: login.expiresAt,
  });

  await runner.cancelCodexDeviceLogin(login.loginId, async (url, init) => {
    assert.equal(
      String(url),
      "http://runner.internal:6990/auth/codex/device-login/login_safe-123",
    );
    assert.equal(init.method, "DELETE");
    return Response.json({ data: { ...login, status: "cancelled" } });
  });

  await runner.logoutCodex(async (url, init) => {
    assert.equal(String(url), "http://runner.internal:6990/auth/codex/logout");
    assert.equal(init.method, "POST");
    return Response.json({
      data: {
        status: "not_authenticated",
        authMode: null,
        email: null,
        planType: null,
        login: null,
      },
    });
  });

  await assert.rejects(
    runner.startCodexDeviceLogin(async () =>
      Response.json({
        data: {
          ...login,
          verificationUrl: "https://openai.example.test/phishing",
        },
      }),
    ),
    /invalid Codex authentication response/,
  );
  await assert.rejects(
    runner.getCodexAuthStatus(async () =>
      Response.json({ data: { status: "authenticated", accessToken: "x" } }),
    ),
    /invalid Codex authentication response/,
  );
  assert.throws(
    () =>
      runner.cancelCodexDeviceLogin("..", async () => {
        throw new Error("an invalid login ID must not reach Runner");
      }),
    /Invalid Codex authentication login ID/,
  );
  await assert.rejects(
    runner.getCodexAuthStatus(
      async () =>
        new Response(
          JSON.stringify({ data: { padding: "x".repeat(70_000) } }),
          {
            headers: { "Content-Type": "application/json" },
          },
        ),
    ),
    /response was too large/,
  );

  const safeError = codexAuthApiError(
    new RunnerRequestError(
      "Runner leaked Bearer secret-token-that-must-not-reach-browser",
      503,
    ),
    "Could not read Codex authentication status",
  );
  assert.equal(safeError.status, 503);
  assert.deepEqual(await safeError.json(), {
    error: {
      code: "CODEX_AUTH_REQUEST_FAILED",
      message: "Could not read Codex authentication status",
    },
  });
});

test("Codex auth UI invalidates stale reads and preserves runtime drafts", async () => {
  const [authUi, runtimeUi] = await Promise.all([
    readFile(path.resolve("components/codex-auth-settings.tsx"), "utf8"),
    readFile(path.resolve("components/runtime-settings.tsx"), "utf8"),
  ]);
  assert.match(authUi, /requestGeneration/);
  assert.match(authUi, /controller\.abort\(\)/);
  assert.match(authUi, /next === null \? 4_000 : 2_000/);
  assert.match(authUi, /disabled=\{!registered \|\| busy !== null\}/);
  assert.match(authUi, /invalidateStatusReads\(\);\s*setBusy\("cancel"\)/);
  assert.match(authUi, /invalidateStatusReads\(\);\s*setBusy\("logout"\)/);
  assert.doesNotMatch(authUi, /window\.open\(/);
  assert.match(runtimeUi, /refreshCodexHealth/);
  assert.doesNotMatch(runtimeUi, /setRuntimes\(await api/);
});
