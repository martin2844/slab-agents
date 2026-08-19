import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import knexFactory from "knex";

const migrationDirectory = path.resolve("db/migrations");
const require = createRequire(import.meta.url);
const repairMigration = require("../db/migrations/202608190011_fix_custom_integrations.cjs");

async function withMigratedDatabase(run) {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "slab-integrations-"),
  );
  const database = knexFactory({
    client: "better-sqlite3",
    connection: { filename: path.join(temporaryDirectory, "workspace.db") },
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
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

test("migrated databases persist multiple same-kind connectors and operation timeouts", async () => {
  await withMigratedDatabase(async (database) => {
    const columns = await database("custom_http_operations").columnInfo();
    assert.ok(columns.timeout_ms, "timeout_ms must exist after all migrations");

    const timestamp = new Date().toISOString();
    const integrations = [
      ["http-a", "custom_http", "HTTP A", "http_a"],
      ["http-b", "custom_http", "HTTP B", "http_b"],
      ["mcp-a", "custom_mcp", "MCP A", "mcp_a"],
      ["mcp-b", "custom_mcp", "MCP B", "mcp_b"],
    ].map(([id, provider, name, slug]) => ({
      id,
      provider,
      name,
      slug,
      config_json: "{}",
      credentials_ciphertext: "encrypted-test-value",
      enabled: 1,
      version: 1,
      status: "connected",
      created_at: timestamp,
      updated_at: timestamp,
    }));
    await database("integrations").insert(integrations);

    const counts = await database("integrations")
      .select("provider")
      .count({ count: "*" })
      .whereIn("provider", ["custom_http", "custom_mcp"])
      .groupBy("provider")
      .orderBy("provider");
    assert.deepEqual(
      counts.map((row) => [row.provider, Number(row.count)]),
      [
        ["custom_http", 2],
        ["custom_mcp", 2],
      ],
    );

    await database.raw(
      `INSERT INTO custom_http_operations
        (id,integration_id,key,name,description,method,path,parameters_json,response_path,max_response_bytes,max_items,enabled,timeout_ms,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        "operation-a",
        "http-a",
        "get_customer",
        "Get customer",
        "Get one customer",
        "GET",
        "/customers/{customerId}",
        JSON.stringify([
          {
            name: "customerId",
            location: "path",
            type: "string",
            required: true,
          },
        ]),
        "data.customer",
        32768,
        50,
        1,
        12000,
        timestamp,
        timestamp,
      ],
    );
    const operation = await database("custom_http_operations")
      .where({ id: "operation-a" })
      .first();
    assert.equal(operation.timeout_ms, 12000);

    const indexes = await database.raw("PRAGMA index_list(integrations)");
    const providerIndexes = [];
    for (const index of indexes) {
      const info = await database.raw(
        `PRAGMA index_info(${JSON.stringify(String(index.name))})`,
      );
      if (info.length === 1 && info[0].name === "provider") {
        providerIndexes.push(index);
      }
    }
    assert.ok(
      providerIndexes.every((index) => Number(index.unique) === 0),
      "provider may be indexed, but it must not remain unique",
    );
  });
});

test("repair migration fixes databases that already applied the broken custom schema", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "slab-integrations-repair-"),
  );
  const database = knexFactory({
    client: "better-sqlite3",
    connection: { filename: path.join(temporaryDirectory, "workspace.db") },
    useNullAsDefault: true,
  });
  try {
    await database.schema.createTable("agents", (table) => {
      table.text("id").primary();
    });
    await database.schema.createTable("runs", (table) => {
      table.text("id").primary();
    });
    await database.schema.createTable("integrations", (table) => {
      table.text("id").primary();
      table.text("provider").notNullable().unique();
      table.text("name").notNullable();
    });
    await database.schema.createTable("custom_http_operations", (table) => {
      table.text("id").primary();
      table.text("integration_id").notNullable();
    });

    await repairMigration.up(database);

    const columns = await database("custom_http_operations").columnInfo();
    assert.ok(columns.timeout_ms);
    await database("integrations").insert([
      { id: "one", provider: "custom_http", name: "One" },
      { id: "two", provider: "custom_http", name: "Two" },
    ]);
    assert.equal(
      Number(
        (
          await database("integrations")
            .where({ provider: "custom_http" })
            .count({ count: "*" })
            .first()
        ).count,
      ),
      2,
    );
  } finally {
    await database.destroy();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
