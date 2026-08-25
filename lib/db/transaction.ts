import "server-only";

import { db } from "@/lib/db/database";

/**
 * Runs a control-plane unit of work in one immediate SQLite transaction.
 * Repositories intentionally share this seam so cross-aggregate invariants
 * remain atomic while their database implementations stay separate.
 */
export function withImmediateTransaction<T>(callback: () => T): T {
  return db.transaction(callback).immediate();
}
