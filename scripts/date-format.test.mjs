import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  formatDateTime,
  formatDateTimeInTimeZone,
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

test("timezone-aware date formatting includes the requested local time", () => {
  const formatted = formatDateTimeInTimeZone(
    "2026-09-07T12:00:00.000Z",
    "America/Argentina/Buenos_Aires",
  );
  assert.match(formatted, /Sep 7, 2026/);
  assert.match(formatted, /09:00/);
  assert.match(formatted, /GMT-3/);
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
