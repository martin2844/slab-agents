import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";
import knexFactory from "knex";

register("./test-alias-loader.mjs", import.meta.url);

const migrationDirectory = path.resolve("db/migrations");
const digest = (character) => `sha256:${character.repeat(64)}`;

function inventory(overrides = {}) {
  const components = ["agents", "work", "docs", "email", "runner"].map(
    (id) => ({
      id,
      name: `${id[0].toUpperCase()}${id.slice(1)}`,
      services: [`slab-${id}`],
      installed: {
        ref: `ghcr.io/slab/${id}:1.0.0`,
        digest: digest("a"),
        revision: "abcdef1",
      },
      available: {
        ref: `ghcr.io/slab/${id}:1.1.0`,
        digest: digest("b"),
        revision: "bcdef12",
      },
      status: "update_available",
    }),
  );
  return {
    schemaVersion: 1,
    status: "update_available",
    channel: "stable",
    installedStackVersion: "1.0.0",
    availableStackVersion: "1.1.0",
    checkedAt: "2026-08-28T04:00:05Z",
    recoveryReason: null,
    release: {
      releasedAt: "2026-08-28T02:00:00Z",
      severity: "routine",
      releaseNotesUrl: null,
      rollbackCompatibleFromInstalled: true,
    },
    components,
    ...overrides,
  };
}

async function writeStatus(paths, request, result, state = "succeeded") {
  const completedAt = "2026-08-28T04:00:06Z";
  const payload = {
    schemaVersion: 1,
    requestId: request.id,
    action: request.action,
    state,
    channel: request.channel,
    target: request.target,
    requestedAt: request.requestedAt,
    startedAt: request.requestedAt,
    completedAt: state === "running" ? null : completedAt,
    result,
    error: null,
  };
  const filename = path.join(paths.statuses, "requests", `${request.id}.json`);
  await writeFile(filename, `${JSON.stringify(payload)}\n`, { mode: 0o644 });
  await rm(path.join(paths.requests, `${request.id}.json`), { force: true });
}

test("system updates use the constrained bridge and schedule only safe stable releases", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "slab-system-updates-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "workspace.db");
  const requests = path.join(directory, "bridge/requests");
  const statuses = path.join(directory, "bridge/status");
  const currentUid = process.getuid();
  await mkdir(path.join(requests, ".uploads"), {
    recursive: true,
    mode: 0o700,
  });
  await mkdir(path.join(statuses, "requests"), {
    recursive: true,
    mode: 0o755,
  });
  await Promise.all([
    import("node:fs/promises").then(({ chmod }) => chmod(requests, 0o1733)),
    import("node:fs/promises").then(({ chmod }) =>
      chmod(path.join(requests, ".uploads"), 0o700),
    ),
    import("node:fs/promises").then(({ chmod }) => chmod(statuses, 0o755)),
    import("node:fs/promises").then(({ chmod }) =>
      chmod(path.join(statuses, "requests"), 0o755),
    ),
  ]);
  const bridgePaths = {
    requests,
    statuses,
    expectedRootUid: currentUid,
    requestUid: currentUid,
  };
  process.env.SLAB_WORKSPACE_DB = filename;
  process.env.SLAB_UPDATE_REQUEST_DIRECTORY = requests;
  process.env.SLAB_UPDATE_STATUS_DIRECTORY = statuses;
  process.env.SLAB_UPDATE_BRIDGE_ROOT_UID = String(currentUid);

  const migrations = knexFactory({
    client: "better-sqlite3",
    connection: { filename },
    useNullAsDefault: true,
    migrations: { directory: migrationDirectory, loadExtensions: [".cjs"] },
  });
  await migrations.migrate.latest();
  await migrations.destroy();

  const [{ db }, service, { systemUpdateRepository }] = await Promise.all([
    import("../lib/db/database.ts"),
    import("../lib/system-update-service.ts"),
    import("../lib/repositories/system-update-repository.ts"),
  ]);
  t.after(() => db.close());

  const initial = await service.getSystemUpdatesData();
  assert.equal(initial.bridge.available, true);
  assert.equal(initial.policy.enabled, false);
  assert.equal(initial.policy.checkHourUtc, 3);

  const manualTime = new Date("2026-08-27T12:00:00.987Z");
  const check = await service.requestSystemUpdate(
    { action: "check", channel: "stable" },
    { paths: bridgePaths, clock: () => manualTime },
  );
  assert.equal(check.requestedAt, "2026-08-27T12:00:00Z");
  assert.equal(check.expiresAt, "2026-08-27T12:10:00Z");
  const requestPath = path.join(requests, `${check.id}.json`);
  const envelope = JSON.parse(await readFile(requestPath, "utf8"));
  assert.deepEqual(Object.keys(envelope).sort(), [
    "action",
    "channel",
    "expiresAt",
    "requestId",
    "requestedAt",
    "schemaVersion",
    "target",
  ]);
  assert.equal((await stat(requestPath)).mode & 0o777, 0o600);

  await assert.rejects(
    service.requestSystemUpdate(
      { action: "check", channel: "stable" },
      { paths: bridgePaths, clock: () => manualTime },
    ),
    (error) => error.code === "UPDATE_IN_PROGRESS",
  );

  await writeStatus(bridgePaths, check, inventory());
  const checked = await service.getSystemUpdatesData();
  assert.equal(checked.latestCheck.id, check.id);
  assert.equal(checked.latestCheck.result.components.length, 5);
  assert.equal(
    checked.latestCheck.result.components[0].status,
    "update_available",
  );

  await assert.rejects(
    service.requestSystemUpdate(
      { action: "apply", channel: "stable", target: "1.2.0" },
      { paths: bridgePaths, clock: () => manualTime },
    ),
    (error) => error.code === "UPDATE_CHECK_REQUIRED",
  );
  const apply = await service.requestSystemUpdate(
    { action: "apply", channel: "stable", target: "1.1.0" },
    { paths: bridgePaths, clock: () => manualTime },
  );
  assert.equal(
    JSON.parse(await readFile(path.join(requests, `${apply.id}.json`), "utf8"))
      .target,
    "1.1.0",
  );
  await writeStatus(
    bridgePaths,
    apply,
    inventory({
      status: "up_to_date",
      installedStackVersion: "1.1.0",
      components: inventory().components.map((component) => ({
        ...component,
        installed: component.available,
        status: "up_to_date",
      })),
    }),
  );
  await service.reconcileSystemUpdateRequests({ paths: bridgePaths });

  const policy = service.updateSystemUpdatePolicy({
    expectedVersion: 1,
    enabled: true,
    checkHourUtc: 3,
  });
  assert.equal(policy.version, 2);
  const scheduledTime = new Date("2026-08-28T04:00:00Z");
  await service.tickSystemUpdates({
    paths: bridgePaths,
    currentTime: scheduledTime,
    logError: (_, error) => assert.fail(error),
  });
  const scheduledCheck = systemUpdateRepository
    .listRequests()
    .find(
      (request) => request.source === "scheduled" && request.action === "check",
    );
  assert.ok(scheduledCheck);
  const scheduledEnvelope = JSON.parse(
    await readFile(path.join(requests, `${scheduledCheck.id}.json`), "utf8"),
  );
  assert.equal(scheduledEnvelope.channel, "stable");
  assert.equal(scheduledEnvelope.target, null);

  await writeStatus(bridgePaths, scheduledCheck, inventory());
  await service.tickSystemUpdates({
    paths: bridgePaths,
    currentTime: new Date("2026-08-28T04:01:00Z"),
    logError: (_, error) => assert.fail(error),
  });
  const automaticApplies = systemUpdateRepository
    .listRequests()
    .filter(
      (request) => request.source === "scheduled" && request.action === "apply",
    );
  assert.equal(automaticApplies.length, 1);
  assert.equal(automaticApplies[0].target, "1.1.0");
  assert.equal(automaticApplies[0].parentRequestId, scheduledCheck.id);
  assert.equal(
    systemUpdateRepository.getRequest(scheduledCheck.id).automaticDecision,
    "apply_submitted",
  );

  await service.tickSystemUpdates({
    paths: bridgePaths,
    currentTime: new Date("2026-08-28T04:02:00Z"),
    logError: (_, error) => assert.fail(error),
  });
  assert.equal(
    systemUpdateRepository
      .listRequests()
      .filter(
        (request) =>
          request.source === "scheduled" && request.action === "apply",
      ).length,
    1,
    "a completed scheduled check must produce at most one exact-target apply",
  );

  await writeStatus(
    bridgePaths,
    automaticApplies[0],
    inventory({
      status: "up_to_date",
      installedStackVersion: "1.1.0",
      components: inventory().components.map((component) => ({
        ...component,
        installed: component.available,
        status: "up_to_date",
      })),
    }),
  );
  await service.tickSystemUpdates({
    paths: bridgePaths,
    currentTime: new Date("2026-08-29T04:00:00Z"),
    logError: (_, error) => assert.fail(error),
  });
  const unsafeCheck = systemUpdateRepository
    .listRequests()
    .find(
      (request) =>
        request.source === "scheduled" &&
        request.action === "check" &&
        request.id !== scheduledCheck.id,
    );
  assert.ok(unsafeCheck);
  await writeStatus(
    bridgePaths,
    unsafeCheck,
    inventory({
      checkedAt: "2026-08-29T04:00:05Z",
      release: {
        ...inventory().release,
        rollbackCompatibleFromInstalled: false,
      },
    }),
  );
  await service.tickSystemUpdates({
    paths: bridgePaths,
    currentTime: new Date("2026-08-29T04:01:00Z"),
    logError: (_, error) => assert.fail(error),
  });
  assert.equal(
    systemUpdateRepository.getRequest(unsafeCheck.id).automaticDecision,
    "unsafe",
  );
  assert.equal(
    systemUpdateRepository
      .listRequests()
      .filter(
        (request) =>
          request.source === "scheduled" && request.action === "apply",
      ).length,
    1,
    "automatic updates must not apply a release without rollback compatibility",
  );

  const uncertainApply = await service.requestSystemUpdate(
    { action: "apply", channel: "stable", target: "1.1.0" },
    {
      paths: bridgePaths,
      clock: () => new Date("2026-08-29T04:02:00Z"),
    },
  );
  await writeStatus(bridgePaths, uncertainApply, null, "running");
  await service.reconcileSystemUpdateRequests({
    paths: bridgePaths,
    clock: () => new Date("2026-08-29T04:02:05Z"),
  });
  assert.equal(
    systemUpdateRepository.getRequest(uncertainApply.id).state,
    "running",
  );
  await rm(path.join(statuses, "requests", `${uncertainApply.id}.json`));
  await service.reconcileSystemUpdateRequests({
    paths: bridgePaths,
    clock: () => new Date("2026-08-29T05:18:00Z"),
  });
  assert.equal(
    systemUpdateRepository.getRequest(uncertainApply.id).error.code,
    "bridge_status_lost",
  );
  assert.equal(
    systemUpdateRepository
      .listRequests()
      .filter((request) => request.action === "apply").length,
    3,
    "an apply with a lost terminal status must never be replayed",
  );
  await assert.rejects(
    service.requestSystemUpdate(
      { action: "apply", channel: "stable", target: "1.1.0" },
      {
        paths: bridgePaths,
        clock: () => new Date("2026-08-29T05:18:01Z"),
      },
    ),
    (error) => error.code === "UPDATE_CHECK_REQUIRED",
    "an uncertain apply requires a newer successful check before retry",
  );

  const staleCheck = await service.requestSystemUpdate(
    { action: "check", channel: "stable" },
    {
      paths: bridgePaths,
      clock: () => new Date("2026-08-29T05:19:00Z"),
    },
  );
  await writeStatus(bridgePaths, staleCheck, null, "running");
  await service.reconcileSystemUpdateRequests({
    paths: bridgePaths,
    clock: () => new Date("2026-08-29T06:35:00Z"),
  });
  assert.equal(
    systemUpdateRepository.getRequest(staleCheck.id).error.code,
    "bridge_status_stale",
    "a stale running status must not block the update queue forever",
  );

  const unavailablePaths = {
    ...bridgePaths,
    requests: path.join(directory, "missing-bridge/requests"),
  };
  const publicationErrors = [];
  await service.tickSystemUpdates({
    paths: unavailablePaths,
    currentTime: new Date("2026-08-30T04:00:00Z"),
    logError: (message) => publicationErrors.push(message),
  });
  assert.equal(publicationErrors.length, 1);
  assert.equal(
    systemUpdateRepository.getPolicy().lastScheduledAt,
    "2026-08-29T03:00:00Z",
  );
  const failedAttempt = systemUpdateRepository
    .listRequests()
    .find((request) => request.scheduledFor === "2026-08-30T03:00:00Z");
  assert.equal(failedAttempt.state, "failed");
  assert.equal(failedAttempt.error.code, "bridge_submission_failed");

  await service.tickSystemUpdates({
    paths: bridgePaths,
    currentTime: new Date("2026-08-30T04:01:00Z"),
    logError: (_, error) => assert.fail(error),
  });
  assert.equal(
    systemUpdateRepository
      .listRequests()
      .filter((request) => request.scheduledFor === "2026-08-30T03:00:00Z")
      .length,
    1,
    "failed publication retries must use backoff",
  );
  await service.tickSystemUpdates({
    paths: bridgePaths,
    currentTime: new Date("2026-08-30T04:06:00Z"),
    logError: (_, error) => assert.fail(error),
  });
  const retriedCheck = systemUpdateRepository
    .listRequests()
    .find(
      (request) =>
        request.scheduledFor === "2026-08-30T03:00:00Z" &&
        request.state === "submitted",
    );
  assert.ok(retriedCheck);
  assert.equal(
    systemUpdateRepository.getPolicy().lastScheduledAt,
    "2026-08-30T03:00:00Z",
  );
  await writeStatus(
    bridgePaths,
    retriedCheck,
    inventory({
      status: "up_to_date",
      checkedAt: "2026-08-30T04:06:05Z",
      installedStackVersion: "1.1.0",
      components: inventory().components.map((component) => ({
        ...component,
        installed: component.available,
        status: "up_to_date",
      })),
    }),
  );
  await service.tickSystemUpdates({
    paths: bridgePaths,
    currentTime: new Date("2026-08-30T04:07:00Z"),
    logError: (_, error) => assert.fail(error),
  });

  const crashedCheck = systemUpdateRepository.createScheduledCheckIfDue({
    id: randomUUID(),
    action: "check",
    channel: "stable",
    target: null,
    source: "scheduled",
    requestedAt: "2026-08-31T04:00:00Z",
    expiresAt: "2026-08-31T04:10:00Z",
    scheduledFor: "2026-08-31T03:00:00Z",
  });
  assert.ok(crashedCheck);
  assert.equal(
    systemUpdateRepository.getPolicy().lastScheduledAt,
    "2026-08-30T03:00:00Z",
    "creating a durable row does not consume the occurrence before publication",
  );
  await service.reconcileSystemUpdateRequests({
    paths: bridgePaths,
    clock: () => new Date("2026-08-31T04:12:00Z"),
  });
  assert.equal(
    systemUpdateRepository.getRequest(crashedCheck.id).error.code,
    "bridge_timeout",
  );
  await service.tickSystemUpdates({
    paths: bridgePaths,
    currentTime: new Date("2026-08-31T04:12:00Z"),
    logError: (_, error) => assert.fail(error),
  });
  assert.equal(
    systemUpdateRepository.getPolicy().lastScheduledAt,
    "2026-08-31T03:00:00Z",
    "a crash before publication is retried as a safe check",
  );
});
