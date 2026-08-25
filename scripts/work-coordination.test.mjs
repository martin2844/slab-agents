import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  mentionHandles,
  remoteStatusUpdate,
  sameAgentIdentity,
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
  assert.equal(sameAgentIdentity("@Sales", "sales"), true);
  assert.equal(sameAgentIdentity("Sales Agent", "sales agent"), true);
  assert.equal(sameAgentIdentity("coo", "sales"), false);
});

test("assignment completion is scoped to the current deliverable", async () => {
  const source = await readFile(
    new URL("../lib/work-coordination.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /entregable solicitado en este item/i);
  assert.match(source, /aunque queden recomendaciones o próximos pasos/i);
  assert.match(source, /review sólo cuando el entregable mismo requiera/i);
  assert.match(
    source,
    /blocked sólo cuando no puedas producir el entregable actual/i,
  );
  assert.doesNotMatch(
    source,
    /done si el resultado no requiere decisión adicional/i,
  );
});
