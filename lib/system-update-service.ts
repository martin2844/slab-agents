import "server-only";

import { randomUUID } from "node:crypto";
import { constants, lstat, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { conflict, DomainError } from "@/lib/api";
import { systemUpdateRepository } from "@/lib/repositories/system-update-repository";
import type {
  SystemUpdateAction,
  SystemUpdateChannel,
  SystemUpdateCheckResult,
  SystemUpdateRequest,
  SystemUpdatesData,
} from "@/lib/types";

const requestLifetimeMs = 10 * 60_000;
const runningStatusGraceMs = 75 * 60_000;
const statusReadLimit = 300 * 1024;
const semverPattern =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const canonicalTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const identitySchema = z
  .object({
    ref: z.string().min(1).max(500),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    revision: z
      .string()
      .regex(/^[a-f0-9]{7,40}$/)
      .nullable(),
  })
  .strict();

const componentIds = ["agents", "work", "docs", "email", "runner"] as const;
const componentSchema = z
  .object({
    id: z.enum(componentIds),
    name: z.string().min(1).max(100),
    services: z.array(z.string().min(1).max(100)).min(1).max(5),
    installed: identitySchema.nullable(),
    available: identitySchema.nullable(),
    status: z.enum(["up_to_date", "update_available", "recovery_required"]),
  })
  .strict();

const checkResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum([
      "up_to_date",
      "update_available",
      "channel_equivalent",
      "channel_older",
      "recovery_required",
    ]),
    channel: z.enum(["stable", "candidate"]),
    installedStackVersion: z.string().regex(semverPattern),
    availableStackVersion: z.string().regex(semverPattern),
    checkedAt: z.string().regex(canonicalTimestampPattern),
    recoveryReason: z.string().max(500).nullable(),
    release: z
      .object({
        releasedAt: z.string().regex(canonicalTimestampPattern).nullable(),
        severity: z.enum(["routine", "security", "critical"]),
        releaseNotesUrl: z.url().startsWith("https://").max(500).nullable(),
        rollbackCompatibleFromInstalled: z.boolean(),
      })
      .strict(),
    components: z.array(componentSchema).length(componentIds.length),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set(value.components.map(({ id }) => id));
    if (componentIds.some((id) => !ids.has(id))) {
      context.addIssue({
        code: "custom",
        message: "The signed component inventory is incomplete.",
        path: ["components"],
      });
    }
  });

const bridgeStatusSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.string().uuid(),
    action: z.enum(["check", "apply"]).nullable(),
    state: z.enum(["running", "succeeded", "failed"]),
    channel: z.enum(["stable", "candidate"]).nullable(),
    target: z.string().max(200).nullable(),
    requestedAt: z.string().regex(canonicalTimestampPattern).nullable(),
    startedAt: z.string().regex(canonicalTimestampPattern),
    completedAt: z.string().regex(canonicalTimestampPattern).nullable(),
    result: z.unknown().nullable(),
    error: z
      .object({
        code: z.string().min(1).max(100),
        message: z.string().min(1).max(500),
      })
      .strict()
      .nullable(),
  })
  .strict();

type BridgePaths = {
  requests: string;
  statuses: string;
  expectedRootUid: number;
  requestUid: number;
};

type Clock = () => Date;

function pathsFromEnvironment(): BridgePaths {
  return {
    requests:
      process.env.SLAB_UPDATE_REQUEST_DIRECTORY ?? "/run/slab-update/requests",
    statuses:
      process.env.SLAB_UPDATE_STATUS_DIRECTORY ?? "/run/slab-update/status",
    expectedRootUid: Number(process.env.SLAB_UPDATE_BRIDGE_ROOT_UID ?? "0"),
    requestUid: process.getuid?.() ?? 10001,
  };
}

function canonicalTimestamp(value: Date) {
  return new Date(Math.floor(value.getTime() / 1000) * 1000)
    .toISOString()
    .replace(".000Z", "Z");
}

async function assertDirectory(
  directory: string,
  expectedUid: number,
  expectedMode: number,
) {
  const stats = await lstat(directory);
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    stats.uid !== expectedUid ||
    (stats.mode & 0o7777) !== expectedMode
  ) {
    throw new Error("Update bridge directory metadata is unsafe.");
  }
}

async function assertRequestTransport(paths: BridgePaths) {
  await assertDirectory(paths.requests, paths.expectedRootUid, 0o1733);
  await assertDirectory(
    path.join(paths.requests, ".uploads"),
    paths.requestUid,
    0o700,
  );
}

async function assertStatusTransport(paths: BridgePaths) {
  await assertDirectory(paths.statuses, paths.expectedRootUid, 0o755);
  await assertDirectory(
    path.join(paths.statuses, "requests"),
    paths.expectedRootUid,
    0o755,
  );
}

function bridgeUnavailable() {
  return new DomainError(
    "UPDATE_BRIDGE_UNAVAILABLE",
    "The host update bridge is unavailable. Install or upgrade slab-stack before managing updates here.",
    503,
  );
}

function newRequest(input: {
  action: SystemUpdateAction;
  channel: SystemUpdateChannel;
  target: string | null;
  source: SystemUpdateRequest["source"];
  currentTime: Date;
}) {
  const requestedAt = canonicalTimestamp(input.currentTime);
  const expiresAt = canonicalTimestamp(
    new Date(input.currentTime.getTime() + requestLifetimeMs),
  );
  return {
    id: randomUUID(),
    action: input.action,
    channel: input.channel,
    target: input.target,
    source: input.source,
    requestedAt,
    expiresAt,
  };
}

async function publishRequest(
  request: Pick<
    SystemUpdateRequest,
    "id" | "action" | "channel" | "target" | "requestedAt" | "expiresAt"
  >,
  paths: BridgePaths,
) {
  await assertRequestTransport(paths);
  const upload = path.join(paths.requests, ".uploads", `${request.id}.tmp`);
  const destination = path.join(paths.requests, `${request.id}.json`);
  const payload = `${JSON.stringify({
    schemaVersion: 1,
    requestId: request.id,
    action: request.action,
    channel: request.channel,
    target: request.target,
    requestedAt: request.requestedAt,
    expiresAt: request.expiresAt,
  })}\n`;
  let handle;
  try {
    handle = await open(
      upload,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    await handle.writeFile(payload, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(upload, destination);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(upload, { force: true }).catch(() => undefined);
    throw new Error("The update request could not reach the host bridge.", {
      cause: error,
    });
  }
}

async function readBridgeStatus(
  request: SystemUpdateRequest,
  paths: BridgePaths,
) {
  const filename = path.join(paths.statuses, "requests", `${request.id}.json`);
  let stats;
  try {
    stats = await lstat(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.uid !== paths.expectedRootUid ||
    (stats.mode & 0o7777) !== 0o644 ||
    stats.size < 2 ||
    stats.size > statusReadLimit
  ) {
    throw new Error("Update bridge status metadata is unsafe.");
  }
  const parsed = bridgeStatusSchema.parse(
    JSON.parse(await readFile(filename, "utf8")),
  );
  if (
    parsed.requestId !== request.id ||
    (parsed.action !== null && parsed.action !== request.action) ||
    (parsed.channel !== null && parsed.channel !== request.channel) ||
    (parsed.target !== null && parsed.target !== request.target)
  ) {
    throw new Error("Update bridge status does not match its request.");
  }
  if (parsed.state !== "failed" && (!parsed.action || !parsed.channel)) {
    throw new Error("Update bridge status omitted accepted request fields.");
  }
  let result: SystemUpdateCheckResult | null = null;
  if (parsed.result !== null) {
    result = checkResultSchema.parse(parsed.result);
    if (result.channel !== request.channel) {
      throw new Error("Update inventory channel does not match its request.");
    }
  }
  if (parsed.state === "succeeded" && request.action === "check" && !result) {
    throw new Error("A successful update check omitted its inventory.");
  }
  return { ...parsed, result };
}

export async function reconcileSystemUpdateRequests(
  options: { paths?: BridgePaths; clock?: Clock } = {},
) {
  const paths = options.paths ?? pathsFromEnvironment();
  const currentTime = (options.clock ?? (() => new Date()))();
  let statusTransportAvailable = true;
  try {
    await assertStatusTransport(paths);
  } catch {
    statusTransportAvailable = false;
  }
  for (const request of systemUpdateRepository.listReconcileCandidates()) {
    try {
      const status = statusTransportAvailable
        ? await readBridgeStatus(request, paths)
        : null;
      if (status) {
        if (
          status.state === "running" &&
          currentTime.getTime() >
            Date.parse(status.startedAt) + runningStatusGraceMs
        ) {
          systemUpdateRepository.markFailed(
            request.id,
            "bridge_status_stale",
            "The host update result is uncertain because it exceeded the worker time limit. Run a new check before attempting another update.",
            canonicalTimestamp(currentTime),
          );
        } else {
          systemUpdateRepository.updateFromBridgeStatus({
            id: request.id,
            state: status.state,
            startedAt: status.startedAt,
            completedAt: status.completedAt,
            result: status.result,
            error: status.error,
          });
        }
        if (
          request.source === "scheduled" &&
          request.action === "check" &&
          request.scheduledFor
        ) {
          systemUpdateRepository.markScheduledOccurrencePublished(
            request.id,
            request.scheduledFor,
          );
        }
      } else if (
        request.state === "submitted" &&
        currentTime.getTime() > Date.parse(request.expiresAt) + 60_000
      ) {
        systemUpdateRepository.markFailed(
          request.id,
          "bridge_timeout",
          "The host did not accept this update request before it expired.",
          canonicalTimestamp(currentTime),
        );
      } else if (
        request.state === "running" &&
        request.startedAt &&
        currentTime.getTime() >
          Date.parse(request.startedAt) + runningStatusGraceMs
      ) {
        systemUpdateRepository.markFailed(
          request.id,
          "bridge_status_lost",
          "The host update result is uncertain because its running status disappeared. Run a new check before attempting another update.",
          canonicalTimestamp(currentTime),
        );
      }
    } catch {
      systemUpdateRepository.markFailed(
        request.id,
        "bridge_contract_mismatch",
        "The host returned an invalid or mismatched update status.",
        canonicalTimestamp(currentTime),
      );
    }
  }
}

export async function requestSystemUpdate(
  input: {
    action: SystemUpdateAction;
    channel: SystemUpdateChannel;
    target?: string | null;
  },
  options: { paths?: BridgePaths; clock?: Clock; source?: "manual" } = {},
) {
  const target = input.target ?? null;
  let authorizingCheck: SystemUpdateRequest | null = null;
  if (input.action === "apply" && (!target || !semverPattern.test(target))) {
    throw new DomainError(
      "INVALID_UPDATE_TARGET",
      "Apply requires the exact version returned by a successful update check.",
      400,
    );
  }
  if (input.action === "check" && target !== null) {
    throw new DomainError(
      "INVALID_UPDATE_TARGET",
      "A new update check cannot include a target version.",
      400,
    );
  }
  if (input.action === "apply") {
    const inventory = systemUpdateRepository.getLatestSuccessfulCheck(
      input.channel,
    );
    const latestApply = systemUpdateRepository.getLatestApply(input.channel);
    if (
      !inventory?.result ||
      inventory.result.status !== "update_available" ||
      inventory.result.availableStackVersion !== target ||
      latestApply?.parentRequestId === inventory.id
    ) {
      throw new DomainError(
        "UPDATE_CHECK_REQUIRED",
        "Run a fresh update check before applying this exact release.",
        409,
      );
    }
    authorizingCheck = inventory;
  }

  const currentTime = (options.clock ?? (() => new Date()))();
  const pending = newRequest({
    action: input.action,
    channel: input.channel,
    target,
    source: "manual",
    currentTime,
  });
  const request = systemUpdateRepository.createManualRequest({
    ...pending,
    parentRequestId: authorizingCheck?.id ?? null,
  });
  if (!request) {
    throw conflict(
      "Another system update request is already running.",
      "UPDATE_IN_PROGRESS",
    );
  }
  try {
    await publishRequest(request, options.paths ?? pathsFromEnvironment());
    return request;
  } catch {
    systemUpdateRepository.markFailed(
      request.id,
      "bridge_submission_failed",
      "The update request could not reach the host bridge.",
      canonicalTimestamp(currentTime),
    );
    throw bridgeUnavailable();
  }
}

export function updateSystemUpdatePolicy(input: {
  expectedVersion: number;
  enabled: boolean;
  checkHourUtc: number;
}) {
  if (
    !Number.isInteger(input.checkHourUtc) ||
    input.checkHourUtc < 0 ||
    input.checkHourUtc > 23
  ) {
    throw new DomainError(
      "INVALID_UPDATE_SCHEDULE",
      "The daily update check hour must be between 00:00 and 23:00 UTC.",
      400,
    );
  }
  const policy = systemUpdateRepository.updatePolicy(input);
  if (!policy) {
    throw conflict(
      "The automatic update policy changed. Refresh and try again.",
      "VERSION_CONFLICT",
    );
  }
  return policy;
}

export async function getSystemUpdatesData(): Promise<SystemUpdatesData> {
  const paths = pathsFromEnvironment();
  await reconcileSystemUpdateRequests({ paths });
  let available = true;
  try {
    await Promise.all([
      assertRequestTransport(paths),
      assertStatusTransport(paths),
    ]);
  } catch {
    available = false;
  }
  const requests = systemUpdateRepository.listRequests();
  return {
    bridge: {
      available,
      message: available
        ? "Host update bridge connected."
        : "Host update bridge not detected. Upgrade slab-stack to enable managed updates.",
    },
    policy: systemUpdateRepository.getPolicy(),
    latestRequest: requests[0] ?? null,
    latestCheck: systemUpdateRepository.getLatestInventory(),
    requests,
  };
}

function automaticDecision(request: SystemUpdateRequest) {
  const result = request.result;
  if (!result || result.channel !== "stable") return "not_applicable" as const;
  if (result.status === "up_to_date") return "up_to_date" as const;
  if (
    result.status !== "update_available" ||
    result.recoveryReason ||
    !result.release.rollbackCompatibleFromInstalled ||
    result.components.some(({ status }) => status === "recovery_required")
  ) {
    return "unsafe" as const;
  }
  return "apply" as const;
}

function scheduledFor(currentTime: Date, hourUtc: number) {
  const scheduled = new Date(
    Date.UTC(
      currentTime.getUTCFullYear(),
      currentTime.getUTCMonth(),
      currentTime.getUTCDate(),
      hourUtc,
    ),
  );
  return currentTime >= scheduled ? scheduled : null;
}

export async function tickSystemUpdates(
  options: {
    paths?: BridgePaths;
    currentTime?: Date;
    logError?: (message: string, error: unknown) => void;
  } = {},
) {
  const paths = options.paths ?? pathsFromEnvironment();
  const currentTime = options.currentTime ?? new Date();
  const logError =
    options.logError ?? ((message, error) => console.error(message, error));
  await reconcileSystemUpdateRequests({ paths, clock: () => currentTime });

  const awaiting = systemUpdateRepository.getScheduledCheckAwaitingDecision();
  if (awaiting) {
    const policy = systemUpdateRepository.getPolicy();
    const decision = policy.enabled
      ? automaticDecision(awaiting)
      : ("not_applicable" as const);
    if (decision === "apply") {
      const pending = newRequest({
        action: "apply",
        channel: "stable",
        target: awaiting.result!.availableStackVersion,
        source: "scheduled",
        currentTime,
      });
      const apply = systemUpdateRepository.createAutomaticApply(
        awaiting.id,
        pending,
      );
      if (apply) {
        try {
          await publishRequest(apply, paths);
        } catch (error) {
          systemUpdateRepository.markFailed(
            apply.id,
            "bridge_submission_failed",
            "The automatic update request could not reach the host bridge.",
            canonicalTimestamp(currentTime),
          );
          logError("[scheduler] Automatic system update submission:", error);
        }
      }
    } else {
      systemUpdateRepository.markAutomaticDecision(awaiting.id, decision);
    }
  }

  const policy = systemUpdateRepository.getPolicy();
  if (!policy.enabled) return;
  const occurrence = scheduledFor(currentTime, policy.checkHourUtc);
  if (!occurrence) return;
  const pending = newRequest({
    action: "check",
    channel: "stable",
    target: null,
    source: "scheduled",
    currentTime,
  });
  const check = systemUpdateRepository.createScheduledCheckIfDue({
    ...pending,
    scheduledFor: canonicalTimestamp(occurrence),
  });
  if (!check) return;
  try {
    await publishRequest(check, paths);
    systemUpdateRepository.markScheduledOccurrencePublished(
      check.id,
      check.scheduledFor!,
    );
  } catch (error) {
    systemUpdateRepository.markFailed(
      check.id,
      "bridge_submission_failed",
      "The automatic update check could not reach the host bridge.",
      canonicalTimestamp(currentTime),
    );
    logError("[scheduler] Automatic system update check:", error);
  }
}
