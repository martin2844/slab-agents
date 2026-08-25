import "server-only";

import { db } from "@/lib/db/database";

export const healthRepository = {
  inspect(requiredTables: string[]) {
    db.prepare("SELECT 1").get();
    const presentTables = (
      db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name IN (${requiredTables.map(() => "?").join(",")})`,
        )
        .all(...requiredTables) as Array<{ name: string }>
    ).map(({ name }) => name);
    const appliedMigrations = presentTables.includes("knex_migrations")
      ? (
          db
            .prepare("SELECT name FROM knex_migrations ORDER BY name")
            .all() as Array<{ name: string }>
        ).map(({ name }) => name)
      : [];

    return { presentTables, appliedMigrations };
  },
};
