/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

const filename = path.resolve(
  process.env.SLAB_WORKSPACE_DB ||
    path.join(process.cwd(), ".data", "slab-workspace.db"),
);

fs.mkdirSync(path.dirname(filename), { recursive: true });

module.exports = {
  client: "better-sqlite3",
  connection: { filename },
  useNullAsDefault: true,
  migrations: {
    directory: path.join(process.cwd(), "db", "migrations"),
    loadExtensions: [".cjs"],
  },
  seeds: {
    directory: path.join(process.cwd(), "db", "seeds"),
    loadExtensions: [".cjs"],
  },
  pool: {
    afterCreate(connection, done) {
      connection.pragma("journal_mode = WAL");
      connection.pragma("foreign_keys = ON");
      connection.pragma("busy_timeout = 5000");
      done(null, connection);
    },
  },
};
