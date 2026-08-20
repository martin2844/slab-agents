import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("production builds are pure and container startup owns migrations", async () => {
  const [packageSource, nextConfig, database, dockerfile, entrypoint] =
    await Promise.all([
      read("package.json"),
      read("next.config.ts"),
      read("lib/db.ts"),
      read("Dockerfile"),
      read("scripts/container-entrypoint.sh"),
    ]);
  const packageJson = JSON.parse(packageSource);

  assert.equal(packageJson.scripts.prebuild, undefined);
  assert.equal(packageJson.scripts.prestart, undefined);
  assert.match(nextConfig, /output: "standalone"/);
  assert.match(database, /NEXT_PHASE === "phase-production-build"/);
  assert.match(database, /\? ":memory:"/);
  assert.match(entrypoint, /umask 077/);
  assert.match(entrypoint, /chmod 700/);
  assert.match(entrypoint, /knex --knexfile knexfile\.cjs migrate:latest/);
  assert.match(entrypoint, /exec node server\.js/);
  assert.match(dockerfile, /USER slab/);
  assert.match(dockerfile, /SLAB_WORKSPACE_DB=\/data\/slab-workspace\.db/);
  assert.match(dockerfile, /test ! -e \.data\/slab-workspace\.db/);
});

test("the production image exposes distinct liveness and readiness contracts", async () => {
  const [health, ready, dockerfile] = await Promise.all([
    read("app/health/route.ts"),
    read("app/ready/route.ts"),
    read("Dockerfile"),
  ]);

  assert.match(health, /status: "ok"/);
  assert.match(ready, /databaseReadiness/);
  assert.match(ready, /status: readiness\.ready \? 200 : 503/);
  assert.match(dockerfile, /127\.0\.0\.1:3009\/health/);
});

test("container-only credentials support secret files and internal Docker DNS", async () => {
  const [settings, runner, email, integrations, serverConfig] =
    await Promise.all([
      read("lib/settings.ts"),
      read("lib/runner.ts"),
      read("lib/integrations/email-client.ts"),
      read("lib/integrations/service.ts"),
      read("lib/server-config.ts"),
    ]);

  assert.match(settings, /TRACKER_API_KEY_FILE/);
  assert.match(settings, /DOCS_API_KEY_FILE/);
  assert.match(runner, /RUNNER_TOKEN_FILE/);
  assert.match(email, /SLAB_EMAIL_ADMIN_KEY_FILE/);
  assert.match(serverConfig, /CONTROL_PLANE_INTERNAL_URL/);
  assert.doesNotMatch(
    integrations,
    /http:\/\/127\.0\.0\.1:\$\{port\}\/api\/integrations/,
  );
  assert.match(integrations, /internalRoute\(/);
});
