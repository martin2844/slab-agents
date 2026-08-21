import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("How it works documents the shipped ecosystem and provider setup", async () => {
  const guide = await read("components/how-it-works-guide.tsx");

  for (const required of [
    "Slab Agents",
    "Work",
    "Docs",
    "slab-email",
    "Runner",
    "Custom Integrations",
    "Connect Gmail",
    "Connect Proton",
    "Microsoft 365",
    "AgentMail",
    "Resend",
    "IMAP / SMTP",
    "Google Auth Platform",
    "Test users",
    "Authorized redirect URI",
    "gmail.readonly, gmail.compose, gmail.send",
    "sudo slabctl proton setup",
    "Managed Bridge",
    "Manual Bridge field reference",
    "Capability snapshots are immutable during a run",
  ]) {
    assert.match(
      guide,
      new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }

  assert.doesNotMatch(guide, /Gmail, Calendar, CRM, analytics.*deferred/);
  assert.doesNotMatch(guide, /No login or multi-tenant account model/);
  assert.match(guide, /0\.0\.0\.0[\s\S]*server bind address/);
  assert.match(guide, /chat message B[\s\S]*runtime thread X resumed/);
  assert.match(
    guide,
    /assignment \/ review \/ work_item \/ task[\s\S]*fresh runtime thread/,
  );
});

test("How it works links every operational guide chapter", async () => {
  const guide = await read("components/how-it-works-guide.tsx");

  for (const anchor of [
    "#ecosystem",
    "#setup",
    "#agents",
    "#tools",
    "#email",
    "#gmail",
    "#proton",
    "#runs",
    "#troubleshooting",
  ]) {
    assert.match(guide, new RegExp(anchor));
  }
});
