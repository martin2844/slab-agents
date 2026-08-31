import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the human Docs surface stays scoped to operator and agent-authored workspace documents", async () => {
  const [client, pageData, route, sourceSync, runAccess] = await Promise.all([
    readFile(new URL("../lib/mcp/docs-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/page-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/docs/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/sources/service.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/docs-access.ts", import.meta.url), "utf8"),
  ]);

  assert.match(
    client,
    /listWorkspace:\s*async \(\) =>\s*DocsClient\.list\(\{ collection_id: "workspace" \}\)/,
  );
  assert.match(client, /searchWorkspace:[\s\S]*collection_id: "workspace"/);
  assert.match(pageData, /DocsClient\.listWorkspace\(\)/);
  assert.match(route, /DocsClient\.searchWorkspace\(q\)/);
  assert.match(route, /DocsClient\.listWorkspace\(\)/);

  assert.match(sourceSync, /DocsClient\.ensureCollection\([\s\S]*kind: "source"/);
  assert.match(sourceSync, /DocsClient\.list\(\{\s*tag:/);
  assert.doesNotMatch(sourceSync, /DocsClient\.listWorkspace/);
  assert.match(
    runAccess,
    /const readCollectionIds = \[\s*"workspace",\s*\.\.\.sourceSnapshot/,
  );
});
