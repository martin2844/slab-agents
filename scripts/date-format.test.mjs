import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  formatDateTime,
  formatRelativeFuture,
  formatRelativePast,
} from "../lib/utils.ts";

test("date formatting is deterministic and labels its timezone", () => {
  assert.equal(
    formatDateTime("2026-08-17T09:20:41.000Z"),
    "2026-08-17 09:20 UTC",
  );
  assert.equal(formatDateTime("not-a-date"), "Unknown time");
});

test("relative timestamps are deterministic when given a reference time", () => {
  const currentTime = new Date("2026-08-31T12:00:00.000Z");
  assert.equal(
    formatRelativePast("2026-08-31T11:48:00.000Z", currentTime),
    "12m ago",
  );
  assert.equal(
    formatRelativeFuture("2026-08-31T14:00:00.000Z", currentTime),
    "in 2h",
  );
  assert.equal(formatRelativePast("invalid", currentTime), "Unknown time");
  assert.equal(formatRelativeFuture("invalid", currentTime), "Unknown time");
});

test("SSR-rendered components avoid environment-dependent date formatting", async () => {
  const componentsUrl = new URL("../components/", import.meta.url);
  const files = (await readdir(componentsUrl)).filter((file) =>
    file.endsWith(".tsx"),
  );
  const offenders = [];

  for (const file of files) {
    const source = await readFile(new URL(file, componentsUrl), "utf8");
    if (/\.toLocale(?:String|DateString|TimeString)\(/.test(source)) {
      offenders.push(file);
    }
  }

  assert.deepEqual(offenders, []);
});
