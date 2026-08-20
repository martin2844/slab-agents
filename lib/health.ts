import "server-only";

import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";

const requiredTables = ["settings", "agents", "runs", "knex_migrations"];

export function databaseReadiness() {
  db.prepare("SELECT 1").get();

  const present = new Set(
    (
      db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name IN (${requiredTables.map(() => "?").join(",")})`,
        )
        .all(...requiredTables) as Array<{ name: string }>
    ).map(({ name }) => name),
  );
  const missingTables = requiredTables.filter((table) => !present.has(table));

  const migrationsDirectory = path.join(process.cwd(), "db", "migrations");
  const expectedMigrations = fs
    .readdirSync(migrationsDirectory)
    .filter((filename) => filename.endsWith(".cjs"))
    .sort();
  const appliedMigrations = present.has("knex_migrations")
    ? (
        db
          .prepare("SELECT name FROM knex_migrations ORDER BY name")
          .all() as Array<{
          name: string;
        }>
      ).map(({ name }) => name)
    : [];
  const applied = new Set(appliedMigrations);
  const pendingMigrations = expectedMigrations.filter(
    (name) => !applied.has(name),
  );

  return {
    ready: missingTables.length === 0 && pendingMigrations.length === 0,
    missingTables,
    pendingMigrations,
    appliedMigrations: appliedMigrations.length,
  };
}
