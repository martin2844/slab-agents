import "server-only";
import { randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { DomainError, conflict } from "@/lib/api";
import { withImmediateTransaction } from "@/lib/db/transaction";
import { settingsRepository } from "@/lib/repositories/settings-repository";
import {
  assertStatusTransport,
  pathsFromEnvironment,
  publishRequest,
  readBridgeStatus,
  type HostRequest,
} from "@/lib/system-update-service";

type Installation = HostRequest & {
  state: "submitted" | "running" | "succeeded" | "failed";
  error: string | null;
};
const key = "whatsapp_install_request";
const timestamp = (date: number) =>
  new Date(date).toISOString().replace(/\.\d{3}Z$/, "Z");

export async function getWhatsAppInstallation() {
  const paths = pathsFromEnvironment();
  let available = false;
  try {
    await assertStatusTransport(paths);
    const file = path.join(paths.statuses, "capabilities.json");
    const stats = await lstat(file);
    if (
      stats.isFile() &&
      !stats.isSymbolicLink() &&
      stats.uid === paths.expectedRootUid &&
      (stats.mode & 0o7777) === 0o644 &&
      stats.size < 4096
    ) {
      const capabilities = JSON.parse(await readFile(file, "utf8"));
      available =
        capabilities.schemaVersion === 1 &&
        capabilities.actions?.includes("install_whatsapp") === true;
    }
  } catch {
    /* A previous host manager has no installation capability. */
  }
  const saved = settingsRepository.get(key);
  let installation: Installation | null = saved ? JSON.parse(saved) : null;
  if (installation && ["submitted", "running"].includes(installation.state)) {
    try {
      await assertStatusTransport(paths);
      const status = await readBridgeStatus(installation, paths);
      if (status)
        installation = {
          ...installation,
          state: status.state,
          error: status.error?.message ?? null,
        };
      const deadline =
        Date.parse(installation.requestedAt) +
        (installation.state === "running" ? 75 : 12) * 60_000;
      if (
        ["submitted", "running"].includes(installation.state) &&
        Date.now() > deadline
      )
        installation = {
          ...installation,
          state: "failed",
          error: "Host installation timed out. Check the host before retrying.",
        };
    } catch {
      installation = {
        ...installation,
        state: "failed",
        error: "The host returned an invalid installation status.",
      };
    }
    if (
      !settingsRepository.compareAndSet(
        key,
        saved!,
        JSON.stringify(installation),
      )
    ) {
      const latest = settingsRepository.get(key);
      installation = latest ? JSON.parse(latest) : null;
    }
  }
  return { available, installation };
}

export async function installWhatsApp() {
  const status = await getWhatsAppInstallation();
  if (!status.available)
    throw new DomainError(
      "HOST_UPGRADE_REQUIRED",
      "Upgrade slab-stack on the host to enable WhatsApp installation.",
      503,
    );
  const request: Installation = {
    id: randomUUID(),
    action: "install_whatsapp",
    channel: "stable",
    target: null,
    requestedAt: timestamp(Date.now()),
    expiresAt: timestamp(Date.now() + 10 * 60_000),
    state: "submitted",
    error: null,
  };
  withImmediateTransaction(() => {
    const raw = settingsRepository.get(key);
    const previous: Installation | null = raw ? JSON.parse(raw) : null;
    if (previous && ["submitted", "running"].includes(previous.state))
      throw conflict("WhatsApp installation is already running.");
    settingsRepository.set(key, JSON.stringify(request));
  });
  try {
    await publishRequest(request, pathsFromEnvironment());
  } catch {
    settingsRepository.compareAndSet(
      key,
      JSON.stringify(request),
      JSON.stringify({
        ...request,
        state: "failed",
        error: "The installation request could not reach the host.",
      }),
    );
    throw new DomainError(
      "HOST_UNAVAILABLE",
      "The installation request could not reach the host.",
      503,
    );
  }
  return request;
}
