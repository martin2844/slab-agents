import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the create agent action submits its form", async () => {
  const source = await readFile(
    new URL("../components/agent-create-dialog.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /<Button type="submit" disabled=\{saving\}>/,
    "Base UI buttons default to type=button, so the create action must opt into form submission",
  );
});
