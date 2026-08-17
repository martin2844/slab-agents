import "server-only";

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const globalForDb = globalThis as unknown as {
  slabWorkspaceDb?: Database.Database;
};

function createDatabase() {
  const configured = process.env.SLAB_WORKSPACE_DB;
  const filename = configured
    ? path.resolve(configured)
    : path.join(process.cwd(), ".data", "slab-workspace.db");
  fs.mkdirSync(path.dirname(filename), { recursive: true });

  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  return db;
}

export const db = globalForDb.slabWorkspaceDb ?? createDatabase();

if (process.env.NODE_ENV !== "production") globalForDb.slabWorkspaceDb = db;

export function now() {
  return new Date().toISOString();
}
