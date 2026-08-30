import "server-only";

import { configuredPublicOrigin } from "@/lib/request-origin";
import { OperationalError } from "@/lib/operational-error";
import { emailAccessRepository } from "@/lib/repositories/email-access-repository";
import { operatorNotificationRepository } from "@/lib/repositories/operator-notification-repository";
import {
  EmailAdminClient,
  sendEmailWithConnectorToken,
} from "@/lib/integrations/email-client";
import {
  deleteEmailConnectorToken,
  readEmailConnectorToken,
  storeEmailConnectorToken,
} from "@/lib/integrations/email-token-vault";
import type {
  OperatorNotificationKind,
  OperatorNotificationState,
} from "@/lib/types";

const MAX_DELIVERY_ATTEMPTS = 5;
const STALE_DELIVERY_CLAIM_MS = 5 * 60_000;
const workerState = globalThis as unknown as {
  slabOperatorNotificationsBusy?: boolean;
};

function publicState(): OperatorNotificationState {
  const settings = operatorNotificationRepository.getSettings();
  return {
    enabled: settings.enabled,
    recipientEmail: settings.recipientEmail,
    accountId: settings.accountId,
    tokenPrefix: settings.tokenPrefix,
    lastTestedAt: settings.lastTestedAt,
    lastError: settings.lastError,
    recentDeliveries: operatorNotificationRepository.listRecent().map(
      ({
        id,
        kind,
        subject,
        status,
        attemptCount,
        lastError,
        createdAt,
        sentAt,
      }) => ({
        id,
        kind,
        subject,
        status,
        attemptCount,
        lastError,
        createdAt,
        sentAt,
      }),
    ),
  };
}

function emailClient() {
  const integration = emailAccessRepository.getEmailIntegrationRecord();
  if (!integration || integration.status !== "connected") {
    throw new OperationalError(
      "Connect and test Email before enabling operator notifications.",
      "EMAIL_CONNECTOR_NOT_READY",
      409,
    );
  }
  return { integration, client: new EmailAdminClient(integration.serviceUrl) };
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function deleteVaultTokenBestEffort(tokenId: string) {
  try {
    deleteEmailConnectorToken(tokenId);
    return true;
  } catch {
    return false;
  }
}

async function revokeTokenOrSchedule(
  serviceUrl: string,
  profileId: string,
  tokenId: string,
) {
  const client = new EmailAdminClient(serviceUrl);
  try {
    await client.revokeToken(profileId, tokenId);
    if (!deleteVaultTokenBestEffort(tokenId)) {
      throw new Error("Scoped Email token was revoked but local vault cleanup failed.");
    }
    operatorNotificationRepository.completeTokenRevocation(tokenId);
  } catch (error) {
    operatorNotificationRepository.scheduleTokenRevocation({
      profileId,
      tokenId,
      serviceUrl,
      error: errorMessage(error, "Scoped Email token revocation failed."),
    });
  }
}

async function retryTokenRevocations() {
  const revocations = operatorNotificationRepository.listDueTokenRevocations();
  if (revocations.length === 0) return;
  for (const revocation of revocations) {
    const client = new EmailAdminClient(revocation.serviceUrl);
    try {
      await client.revokeToken(revocation.profileId, revocation.tokenId);
    } catch (error) {
      if (!String(error).toLowerCase().includes("not found")) {
        const retryAt = new Date(
          Date.now() + Math.min(60 * 60_000, 30_000 * 2 ** revocation.attemptCount),
        ).toISOString();
        operatorNotificationRepository.postponeTokenRevocation(
          revocation.tokenId,
          errorMessage(error, "Scoped Email token revocation failed."),
          retryAt,
        );
        continue;
      }
    }
    if (!deleteVaultTokenBestEffort(revocation.tokenId)) {
      operatorNotificationRepository.postponeTokenRevocation(
        revocation.tokenId,
        "Scoped Email token was revoked but local vault cleanup failed.",
        new Date(Date.now() + 60_000).toISOString(),
      );
      continue;
    }
    operatorNotificationRepository.completeTokenRevocation(revocation.tokenId);
  }
}

export function getOperatorNotificationState() {
  return publicState();
}

export async function saveOperatorNotificationSettings(input: {
  enabled: boolean;
  recipientEmail: string;
  accountId: string | null;
}) {
  const current = operatorNotificationRepository.getSettings();
  if (!input.enabled) {
    operatorNotificationRepository.saveSettings({
      ...current,
      enabled: false,
      recipientEmail: input.recipientEmail,
      accountId: input.accountId,
    });
    return publicState();
  }
  if (!input.accountId) {
    throw new OperationalError("Select the Email account that sends notifications.");
  }

  const { integration, client } = emailClient();
  const sameTokenAuthority = current.tokenServiceUrl === integration.serviceUrl;
  const accounts = await client.listAccounts();
  const account = accounts.find(({ id }) => id === input.accountId);
  if (!account?.enabled || !account.capabilities.send) {
    throw new OperationalError(
      "The selected Email account is unavailable or cannot send messages.",
      "EMAIL_ACCOUNT_CANNOT_SEND",
      409,
    );
  }

  const profileInput = {
    name: "slab-agents:operator-notifications",
    readEnabled: false,
    draftEnabled: false,
    sendEnabled: true,
    accountIds: [account.id],
  };
  let profile;
  if (current.profileId && sameTokenAuthority) {
    try {
      profile = await client.updateProfile(current.profileId, profileInput);
    } catch (error) {
      if (!String(error).includes("not found")) throw error;
      profile = await client.createProfile(profileInput);
    }
  } else {
    profile = await client.createProfile(profileInput);
  }

  let tokenId = profile.id === current.profileId && sameTokenAuthority ? current.tokenId : null;
  let tokenPrefix = profile.id === current.profileId && sameTokenAuthority ? current.tokenPrefix : null;
  let tokenCreatedAt = profile.id === current.profileId && sameTokenAuthority
    ? current.tokenCreatedAt
    : null;
  if (tokenId) {
    try {
      readEmailConnectorToken(tokenId);
    } catch {
      tokenId = null;
    }
  }
  let createdToken: Awaited<ReturnType<EmailAdminClient["createToken"]>> | null = null;
  try {
    if (!tokenId) {
      createdToken = await client.createToken(profile.id);
      storeEmailConnectorToken(createdToken.id, createdToken.token);
      tokenId = createdToken.id;
      tokenPrefix = createdToken.prefix;
      tokenCreatedAt = new Date().toISOString();
    }

    operatorNotificationRepository.saveSettings({
      enabled: true,
      recipientEmail: input.recipientEmail,
      accountId: account.id,
      profileId: profile.id,
      tokenId,
      tokenPrefix,
      tokenCreatedAt,
      tokenServiceUrl: integration.serviceUrl,
      lastError: null,
    });
  } catch (error) {
    if (createdToken) {
      await revokeTokenOrSchedule(
        integration.serviceUrl,
        profile.id,
        createdToken.id,
      );
    }
    throw error;
  }
  if (current.tokenId && current.tokenId !== tokenId) {
    await revokeTokenOrSchedule(
      current.tokenServiceUrl ?? integration.serviceUrl,
      current.profileId!,
      current.tokenId,
    );
  }
  return publicState();
}

function link(pathname: string) {
  const origin = configuredPublicOrigin();
  return origin ? `${origin}${pathname}` : pathname;
}

function enqueue(input: {
  dedupeKey: string;
  kind: OperatorNotificationKind;
  resourceType: string;
  resourceId: string;
  subject: string;
  body: string;
}) {
  return operatorNotificationRepository.enqueue(input);
}

export function discoverOperatorNotifications() {
  const settings = operatorNotificationRepository.getSettings();
  if (!settings.enabled) return 0;
  const candidates = operatorNotificationRepository.listAttentionCandidates(
    settings.enabledAt ?? settings.updatedAt,
  );
  let created = 0;

  for (const row of candidates.approvals) {
    created += Number(Boolean(enqueue({
      dedupeKey: `approval:${row.id}`,
      kind: "approval_waiting",
      resourceType: "approval",
      resourceId: String(row.id),
      subject: `Approval required · ${String(row.agent_name)}`,
      body: [
        `${String(row.agent_name)} is waiting for approval.`,
        String(row.command),
        "",
        `Review: ${link(`/runs/${String(row.run_id)}`)}`,
      ].join("\n"),
    })));
  }
  for (const row of candidates.failedRuns) {
    const automation = row.automation_id ? "Automation run" : "Run";
    created += Number(Boolean(enqueue({
      dedupeKey: `run-failed:${row.id}`,
      kind: "run_failed",
      resourceType: "run",
      resourceId: String(row.id),
      subject: `${automation} failed · ${String(row.agent_name)}`,
      body: [
        `${automation} for ${String(row.agent_name)} failed.`,
        String(row.error ?? "No failure detail was recorded."),
        "",
        `Inspect: ${link(`/runs/${String(row.id)}`)}`,
      ].join("\n"),
    })));
  }
  for (const row of candidates.blockedWork) {
    created += Number(Boolean(enqueue({
      dedupeKey: `work-blocked:${row.issue_key}:${row.state_token}`,
      kind: "work_blocked",
      resourceType: "work",
      resourceId: String(row.issue_key),
      subject: `Work blocked · ${String(row.issue_key)}`,
      body: `Work item ${String(row.issue_key)} is blocked and needs attention.\n\nOpen Work: ${link("/work")}`,
    })));
  }
  for (const row of [...candidates.integrations, ...candidates.emailIntegrations]) {
    created += Number(Boolean(enqueue({
      dedupeKey: `integration-unhealthy:${row.id}:${row.updated_at}`,
      kind: "integration_unhealthy",
      resourceType: "integration",
      resourceId: String(row.id),
      subject: `Integration unavailable · ${String(row.name)}`,
      body: `${String(row.name)} is marked unavailable.\n\nOpen Settings: ${link("/settings")}`,
    })));
  }
  for (const row of candidates.updates) {
    created += Number(Boolean(enqueue({
      dedupeKey: `system-update-failed:${row.id}`,
      kind: "system_update_failed",
      resourceType: "system_update",
      resourceId: String(row.id),
      subject: `Slab ${String(row.action)} failed`,
      body: [
        `The Slab ${String(row.action)} request failed.`,
        String(row.error_message ?? row.error_code ?? "No failure detail was recorded."),
        "",
        `Inspect: ${link("/settings/system")}`,
      ].join("\n"),
    })));
  }
  return created;
}

async function deliver(id: string) {
  const delivery = operatorNotificationRepository.claim(id);
  if (!delivery) return;
  const settings = operatorNotificationRepository.getSettings();
  try {
    if (!operatorNotificationRepository.isStillActionable(delivery)) {
      operatorNotificationRepository.markCancelled(
        delivery.id,
        "Attention state resolved before delivery",
      );
      return;
    }
    if (
      !settings.enabled ||
      !settings.accountId ||
      !settings.tokenId ||
      !settings.recipientEmail
    ) {
      throw new Error("Operator notification settings are incomplete.");
    }
    const { integration, client } = emailClient();
    const account = (await client.listAccounts()).find(
      ({ id: accountId }) => accountId === settings.accountId,
    );
    if (!account?.enabled || !account.capabilities.send) {
      throw new Error("The notification sender is unavailable or cannot send.");
    }
    await sendEmailWithConnectorToken({
      serviceUrl: integration.serviceUrl,
      bearerToken: readEmailConnectorToken(settings.tokenId),
      accountId: account.id,
      expectedFrom: account.emailAddress,
      to: settings.recipientEmail,
      subject: delivery.subject,
      text: delivery.body,
      idempotencyKey: `slab-notification:${delivery.id}`,
    });
    operatorNotificationRepository.markSent(delivery.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Notification delivery failed.";
    const retryAt =
      delivery.attemptCount >= MAX_DELIVERY_ATTEMPTS
        ? null
        : new Date(
            Date.now() + Math.min(60 * 60_000, 30_000 * 2 ** (delivery.attemptCount - 1)),
          ).toISOString();
    operatorNotificationRepository.markFailed(delivery.id, message, retryAt);
  }
}

export async function tickOperatorNotifications() {
  if (workerState.slabOperatorNotificationsBusy) return;
  workerState.slabOperatorNotificationsBusy = true;
  try {
    await retryTokenRevocations();
    operatorNotificationRepository.recoverStaleClaims(
      new Date(Date.now() - STALE_DELIVERY_CLAIM_MS).toISOString(),
    );
    discoverOperatorNotifications();
    for (const delivery of operatorNotificationRepository.listDue()) {
      await deliver(delivery.id);
    }
  } finally {
    workerState.slabOperatorNotificationsBusy = false;
  }
}

export async function testOperatorNotifications() {
  const settings = operatorNotificationRepository.getSettings();
  const testedAt = new Date().toISOString();
  try {
    if (!settings.enabled || !settings.accountId || !settings.tokenId) {
      throw new OperationalError("Enable and save operator notifications first.");
    }
    const { integration, client } = emailClient();
    const account = (await client.listAccounts()).find(
      ({ id }) => id === settings.accountId,
    );
    if (!account?.enabled || !account.capabilities.send) {
      throw new Error("The notification sender is unavailable or cannot send.");
    }
    await sendEmailWithConnectorToken({
      serviceUrl: integration.serviceUrl,
      bearerToken: readEmailConnectorToken(settings.tokenId),
      accountId: account.id,
      expectedFrom: account.emailAddress,
      to: settings.recipientEmail,
      subject: "Slab operator notifications are ready",
      text: "This is a test notification from your Slab workspace.",
      idempotencyKey: `slab-notification-test:${crypto.randomUUID()}`,
    });
    operatorNotificationRepository.recordTest({ testedAt, error: null });
    return publicState();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Notification test failed.";
    operatorNotificationRepository.recordTest({ testedAt, error: message });
    throw error;
  }
}
