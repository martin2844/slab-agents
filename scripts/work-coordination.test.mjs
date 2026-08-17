import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  mentionHandles,
  remoteStatusUpdate,
  semanticStatus,
} from "../lib/work-status.ts";

test("review and blocked are represented by adapter-owned labels", () => {
  assert.equal(semanticStatus("in_progress", ["status:review"]), "review");
  assert.equal(semanticStatus("in_progress", ["status:blocked"]), "blocked");
  assert.equal(semanticStatus("done", ["status:review"]), "done");
  assert.deepEqual(remoteStatusUpdate("review", ["sales", "status:blocked"]), {
    status: "in_progress",
    labels: ["sales", "status:review"],
  });
  assert.deepEqual(remoteStatusUpdate("done", ["sales", "status:review"]), {
    status: "done",
    labels: ["sales"],
  });
});

test("mentions are case-insensitive, slug-safe, and deduplicated", () => {
  assert.deepEqual(mentionHandles("@COO please ask @sales-chief, then @coo"), [
    "coo",
    "sales-chief",
  ]);
});

test("work coordination persists dedupe state and uses Work as truth", async () => {
  const [source, runner, migration] = await Promise.all([
    readFile(new URL("../lib/work-coordination.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/runner.ts", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../db/migrations/202608170005_work_coordination.cjs",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(source, /claimWorkCoordinationEvent/);
  assert.match(source, /getOrCreateWorkAgentThread/);
  assert.match(source, /type: "assignment"/);
  assert.match(source, /type: "resumed"/);
  assert.match(source, /type: "review_requested"/);
  assert.match(source, /type: "blocked"/);
  assert.match(source, /type: "mention"/);
  assert.match(source, /coveredByStateEvent/);
  assert.match(source, /el work item es la fuente de verdad/i);
  assert.match(runner, /assignee slug/);
  assert.match(runner, /Use Work items and comments/);
  assert.match(migration, /createTable\("work_coordination_events"/);
  assert.match(migration, /dedupe_key/);
});
