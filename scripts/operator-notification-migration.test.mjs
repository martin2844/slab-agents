import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import knexFactory from "knex";

const migrationDirectory = path.resolve("db/migrations");

test("token revocation debt is added to databases that already applied operator notifications", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "slab-notification-migration-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const knex = knexFactory({
    client: "better-sqlite3",
    connection: { filename: path.join(directory, "workspace.db") },
    useNullAsDefault: true,
    migrations: { directory: migrationDirectory, loadExtensions: [".cjs"] },
  });
  t.after(() => knex.destroy());

  const filenames = (await readdir(migrationDirectory))
    .filter((name) => name.endsWith(".cjs"))
    .sort();
  for (const name of filenames) {
    await knex.migrate.up({ name });
    if (name === "202608300035_operator_notifications.cjs") break;
  }

  assert.equal(
    await knex.schema.hasTable("operator_notification_token_revocations"),
    false,
  );
  const timestamp = "2026-08-30T00:00:00.000Z";
  await knex("email_integrations").insert({
    id: "email",
    service_url: "http://email.example.test",
    status: "connected",
    created_at: timestamp,
    updated_at: timestamp,
  });
  await knex("operator_notification_settings").where({ id: 1 }).update({
    profile_id: "profile-existing",
    token_id: "token-existing",
  });

  await knex.migrate.latest();

  assert.equal(
    await knex.schema.hasTable("operator_notification_token_revocations"),
    true,
  );
  assert.equal(
    await knex.schema.hasColumn("operator_notification_settings", "token_service_url"),
    true,
  );
  assert.equal(
    (await knex("operator_notification_settings").select("token_service_url").first())
      ?.token_service_url,
    "http://email.example.test",
  );
  await knex("operator_notification_token_revocations").insert({
    token_id: "token-to-revoke",
    profile_id: "profile-1",
    service_url: "http://email.example.test",
    attempt_count: 0,
    next_attempt_at: timestamp,
    created_at: timestamp,
  });
  assert.equal(
    await knex("operator_notification_token_revocations").count({ count: "*" }).first()
      .then((row) => Number(row?.count ?? 0)),
    1,
  );
});
