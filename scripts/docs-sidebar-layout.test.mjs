import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Docs sidebar keeps navigation icons stable beside long titles", async () => {
  const source = await readFile(
    new URL("../components/docs-workspace.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /<ChevronRight className="size-3\.5 shrink-0" \/>/);
  assert.match(source, /<FileText className="size-3\.5 shrink-0" \/>/);
  assert.match(source, /<Search className="size-3\.5 shrink-0" \/>/);
  assert.ok(
    source.match(/className="min-w-0 flex-1 truncate"/g)?.length >= 2,
    "tree and search titles must own the flexible, truncating column",
  );
});
