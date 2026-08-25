import "server-only";

import { db, now } from "@/lib/db";

export const settingsStore = {
  get(key: string) {
    return (
      (
        db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
          | { value: string }
          | undefined
      )?.value ?? null
    );
  },
  set(key: string, value: string) {
    db.prepare(
      "INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
    ).run(key, value, now());
  },
  compareAndSet(key: string, expectedValue: string, value: string) {
    return (
      db
        .prepare(
          "UPDATE settings SET value=?, updated_at=? WHERE key=? AND value=?",
        )
        .run(value, now(), key, expectedValue).changes === 1
    );
  },
};
