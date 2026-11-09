import "server-only";
import { db, now } from "@/lib/db/database";
import { conflict } from "@/lib/api";
export type DocsRunAccess = {
  run_id: string;
  service_url: string;
  closed_at: string | null;
};
export const docsRunRepository = {
  get(runId: string) {
    return db
      .prepare("SELECT * FROM run_docs_access WHERE run_id=?")
      .get(runId) as DocsRunAccess | undefined;
  },
  register(runId: string, serviceUrl: string) {
    const existing = docsRunRepository.get(runId);
    if (existing && (existing.service_url !== serviceUrl || existing.closed_at))
      throw conflict("Docs access for this run cannot be changed or reopened.");
    db.prepare(
      "INSERT OR IGNORE INTO run_docs_access(run_id,service_url,created_at) VALUES (?,?,?)",
    ).run(runId, serviceUrl, now());
  },
  markClosed(runId: string) {
    db.prepare("UPDATE run_docs_access SET closed_at=? WHERE run_id=?").run(
      now(),
      runId,
    );
  },
  pendingClosure() {
    return db
      .prepare(
        `SELECT a.run_id FROM run_docs_access a JOIN runs r ON r.id=a.run_id
  WHERE a.closed_at IS NULL AND r.status IN ('completed','failed','cancelled','skipped') ORDER BY r.completed_at LIMIT 50`,
      )
      .all() as { run_id: string }[];
  },
};
