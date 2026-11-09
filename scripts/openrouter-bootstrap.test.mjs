import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";
import Database from "better-sqlite3";
import knexFactory from "knex";
import {
  bootstrapOpenRouter,
  openRouterAvailable,
} from "./openrouter-bootstrap.mjs";

register("./test-alias-loader.mjs", import.meta.url);

test("installer OpenRouter configuration is verified, encrypted, usable and preserved on retry", async (t) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "slab-openrouter-bootstrap-"),
  );
  const filename = path.join(directory, "workspace.db");
  process.env.SLAB_WORKSPACE_DB = filename;
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
  const database = new Database(filename);
  t.after(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });
  const original = database
    .prepare("SELECT * FROM runtime_configs WHERE runtime_id='openrouter'")
    .get();
  const credential = "sk-or-test-bootstrap-secret";
  const model = "provider/tool-model";
  const fetcher = async (url, init) => {
    assert.equal(init.headers.Authorization, `Bearer ${credential}`);
    assert.equal(init.redirect, "manual");
    if (url === "https://openrouter.ai/api/v1/key")
      return Response.json({ data: { label: "test" } });
    assert.equal(
      url,
      "https://openrouter.ai/api/v1/models?supported_parameters=tools&zdr=true",
    );
    return Response.json({
      data: [
        { id: model, supported_parameters: ["tools"] },
        { id: "provider/no-tools", supported_parameters: [] },
      ],
    });
  };
  await assert.rejects(
    bootstrapOpenRouter(
      database,
      credential,
      model,
      async () =>
        new Response("credential must not be logged", { status: 401 }),
    ),
    /rejected/,
  );
  await assert.rejects(
    bootstrapOpenRouter(database, credential, "provider/no-tools", fetcher),
    /not available/,
  );
  await assert.rejects(
    bootstrapOpenRouter(
      database,
      credential,
      model,
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://other.invalid" },
        }),
    ),
    /redirect/,
  );
  assert.deepEqual(
    database
      .prepare("SELECT * FROM runtime_configs WHERE runtime_id='openrouter'")
      .get(),
    original,
  );
  assert.equal(
    await openRouterAvailable(database, () => {
      throw new Error("must not call Runner");
    }),
    false,
  );

  assert.equal(
    await bootstrapOpenRouter(database, credential, model, fetcher),
    true,
  );
  const configured = database
    .prepare("SELECT * FROM runtime_configs WHERE runtime_id='openrouter'")
    .get();
  assert.equal(configured.enabled, 1);
  assert.equal(configured.last_verification_status, "connected");
  assert.doesNotMatch(
    JSON.stringify(configured),
    /sk-or-test-bootstrap-secret/,
  );
  assert.equal(
    (await stat(path.join(directory, "control-plane.key"))).mode & 0o777,
    0o600,
  );
  const { getRuntimeAuthentication, resolveRuntimeModel } =
    await import("../lib/runtime-config.ts");
  assert.equal(resolveRuntimeModel("openrouter", "default"), model);
  assert.deepEqual(getRuntimeAuthentication("openrouter"), {
    mode: "api_key",
    credential,
    providerRouting: {
      requireParameters: true,
      dataCollection: "deny",
      zdr: true,
    },
  });
  assert.equal(
    await openRouterAvailable(database, async () =>
      Response.json({
        data: [
          {
            id: "openrouter",
            available: false,
            status: "authentication_required",
          },
        ],
      }),
    ),
    true,
  );
  assert.equal(
    await openRouterAvailable(database, async () =>
      Response.json({ data: [{ id: "codex", available: true }] }),
    ),
    false,
  );
  assert.equal(
    await openRouterAvailable(database, async () =>
      Response.json({
        data: [{ id: "openrouter", available: false, status: "unavailable" }],
      }),
    ),
    false,
  );
  assert.equal(
    await bootstrapOpenRouter(database, "replacement", "provider/other", () => {
      throw new Error("must not reconfigure");
    }),
    false,
  );
  assert.deepEqual(
    database
      .prepare("SELECT * FROM runtime_configs WHERE runtime_id='openrouter'")
      .get(),
    configured,
  );

  database
    .prepare(
      "UPDATE runtime_configs SET credential_ciphertext=NULL WHERE runtime_id='openrouter'",
    )
    .run();
  let changed = false;
  await assert.rejects(
    bootstrapOpenRouter(database, credential, model, async (...args) => {
      if (!changed) {
        database
          .prepare(
            "UPDATE runtime_configs SET config_version=config_version+1, enabled=0 WHERE runtime_id='openrouter'",
          )
          .run();
        changed = true;
      }
      return fetcher(...args);
    }),
    /configuration changed/,
  );
  assert.equal(
    database
      .prepare(
        "SELECT enabled FROM runtime_configs WHERE runtime_id='openrouter'",
      )
      .get().enabled,
    0,
  );
  assert.doesNotMatch(
    await readFile(filename, "utf8"),
    /sk-or-test-bootstrap-secret/,
  );
});
