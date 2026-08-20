#!/usr/bin/env node

import Database from "better-sqlite3";
import path from "node:path";
import process from "node:process";
import { hashPassword } from "../lib/auth/password.mjs";

async function readPassword() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 4096) throw new Error("Password input is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "");
}

const rotate = process.argv.includes("--rotate");
const unknownArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--rotate");
if (unknownArguments.length > 0) {
  throw new Error("Usage: admin-bootstrap.mjs [--rotate] < password.txt");
}
if (process.stdin.isTTY) {
  throw new Error("Read the administrator password from stdin.");
}

const password = await readPassword();
if (password.length < 12 || password.length > 1024) {
  throw new Error("Administrator password must contain 12 to 1024 characters.");
}

const filename = path.resolve(
  process.env.SLAB_WORKSPACE_DB || ".data/slab-workspace.db",
);
const database = new Database(filename);
database.pragma("foreign_keys = ON");
database.pragma("busy_timeout = 5000");

try {
  const table = database
    .prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'auth_credentials'",
    )
    .get();
  if (!table) {
    throw new Error("Authentication migrations have not been applied.");
  }

  const existing = database
    .prepare(
      "SELECT session_generation FROM auth_credentials WHERE id = 'admin'",
    )
    .get();
  if (existing && !rotate) {
    throw new Error(
      "Administrator credentials already exist. Use --rotate to replace them.",
    );
  }

  const passwordHash = await hashPassword(password);
  const timestamp = new Date().toISOString();
  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO auth_credentials
          (id, password_hash, session_generation, created_at, updated_at)
         VALUES ('admin', ?, 1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           password_hash = excluded.password_hash,
           session_generation = auth_credentials.session_generation + 1,
           updated_at = excluded.updated_at`,
      )
      .run(passwordHash, timestamp, timestamp);
    if (existing) database.prepare("DELETE FROM auth_sessions").run();
  })();

  process.stdout.write(
    existing
      ? "Administrator password rotated; existing sessions were revoked.\n"
      : "Administrator password configured.\n",
  );
} finally {
  database.close();
}
