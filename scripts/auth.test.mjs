import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import knexFactory from "knex";
import { verifyPassword } from "../lib/auth/password.mjs";

const migrationDirectory = path.resolve("db/migrations");
const read = (filename) =>
  readFile(new URL(`../${filename}`, import.meta.url), "utf8");

async function withMigratedDatabase(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "slab-auth-"));
  const filename = path.join(directory, "workspace.db");
  const database = knexFactory({
    client: "better-sqlite3",
    connection: { filename },
    useNullAsDefault: true,
    migrations: { directory: migrationDirectory, loadExtensions: [".cjs"] },
  });
  try {
    await database.migrate.latest();
    await run(database, filename);
  } finally {
    await database.destroy();
    await rm(directory, { recursive: true, force: true });
  }
}

function bootstrap(filename, password, argumentsList = []) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["scripts/admin-bootstrap.mjs", ...argumentsList],
      {
        cwd: process.cwd(),
        env: { ...process.env, SLAB_WORKSPACE_DB: filename },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(`${password}\n`);
  });
}

test("password bootstrap stores only a scrypt hash and rotation revokes sessions", async () => {
  await withMigratedDatabase(async (database, filename) => {
    const initialPassword = "correct horse battery staple";
    const first = await bootstrap(filename, initialPassword);
    assert.equal(first.code, 0, first.stderr);
    assert.doesNotMatch(first.stdout, new RegExp(initialPassword));

    const credential = await database("auth_credentials")
      .where({ id: "admin" })
      .first();
    assert.notEqual(credential.password_hash, initialPassword);
    assert.equal(
      await verifyPassword(initialPassword, credential.password_hash),
      true,
    );

    const timestamp = new Date().toISOString();
    await database("auth_sessions").insert({
      token_hash: "test-session-hash",
      generation: credential.session_generation,
      created_at: timestamp,
      last_seen_at: timestamp,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    const duplicate = await bootstrap(filename, initialPassword);
    assert.notEqual(duplicate.code, 0);

    const replacement = "another long private password";
    const rotated = await bootstrap(filename, replacement, ["--rotate"]);
    assert.equal(rotated.code, 0, rotated.stderr);
    const updated = await database("auth_credentials")
      .where({ id: "admin" })
      .first();
    assert.equal(updated.session_generation, credential.session_generation + 1);
    assert.equal(
      await verifyPassword(replacement, updated.password_hash),
      true,
    );
    assert.equal(
      Number(
        (await database("auth_sessions").count({ count: "*" }).first()).count,
      ),
      0,
    );
  });
});

test("the proxy protects pages and APIs while preserving health and scoped MCP", async () => {
  const [proxy, service, login, passwordRoute, settings, dockerfile] =
    await Promise.all([
      read("proxy.ts"),
      read("lib/auth/service.ts"),
      read("app/api/auth/login/route.ts"),
      read("app/api/auth/password/route.ts"),
      read("components/settings-view.tsx"),
      read("Dockerfile"),
    ]);

  assert.match(proxy, /AUTHENTICATION_REQUIRED/);
  assert.match(proxy, /sameOriginRequest/);
  assert.match(proxy, /"\/health"/);
  assert.match(proxy, /internalMcpPath/);
  assert.match(service, /auth_sessions/);
  assert.match(service, /auth_login_attempts/);
  assert.match(service, /authenticationReadiness/);
  assert.match(login, /httpOnly: true/);
  assert.match(login, /sameSite: "lax"/);
  assert.match(passwordRoute, /rotateAdminPassword/);
  assert.match(settings, /Change password/);
  assert.match(dockerfile, /admin-bootstrap\.mjs/);
});
