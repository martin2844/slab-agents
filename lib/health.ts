import "server-only";

import fs from "node:fs";
import path from "node:path";
import { healthRepository } from "@/lib/repositories/health-repository";

const requiredTables = ["settings", "agents", "runs", "knex_migrations"];

export function databaseReadiness() {
  const { presentTables, appliedMigrations } =
    healthRepository.inspect(requiredTables);
  const present = new Set(presentTables);
  const missingTables = requiredTables.filter((table) => !present.has(table));

  const migrationsDirectory = path.join(process.cwd(), "db", "migrations");
  const expectedMigrations = fs
    .readdirSync(migrationsDirectory)
    .filter((filename) => filename.endsWith(".cjs"))
    .sort();
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
