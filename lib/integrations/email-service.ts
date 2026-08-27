import "server-only";

import { agentRepository } from "@/lib/repositories/agent-repository";
import { emailAccessRepository } from "@/lib/repositories/email-access-repository";

import { OperationalError } from "@/lib/operational-error";

import {
  EmailAdminClient,
  normalizeEmailServiceUrl,
} from "@/lib/integrations/email-client";
import {
  deleteEmailConnectorToken,
  readEmailConnectorToken,
  storeEmailConnectorToken,
} from "@/lib/integrations/email-token-vault";
import { readSecret } from "@/lib/server-config";
import type {
  AgentEmailAccess,
  EmailAccount,
  EmailIntegrationState,
  EmailSendPolicy,
  GmailOAuthSettings,
  MicrosoftOAuthSettings,
  ManagedProtonBridgeState,
} from "@/lib/types";

const DEFAULT_EMAIL_URL = "http://127.0.0.1:6981";

function currentConfig() {
  return emailAccessRepository.getEmailIntegrationRecord();
}

function configuredServiceUrl() {
  const environmentUrl = process.env.SLAB_EMAIL_URL?.trim();
  return environmentUrl
    ? normalizeEmailServiceUrl(environmentUrl)
    : DEFAULT_EMAIL_URL;
}

function currentServiceUrl() {
  return currentConfig()?.serviceUrl ?? configuredServiceUrl();
}

function client() {
  return new EmailAdminClient(currentServiceUrl());
}

export function isInboundEmailFeedConfigured() {
  return Boolean(
    (currentConfig() || process.env.SLAB_EMAIL_URL?.trim()) &&
    readSecret("SLAB_EMAIL_ADMIN_KEY", "SLAB_EMAIL_ADMIN_KEY_FILE"),
  );
}

export function assertAgentEmailConnectorReady(agentId: string) {
  const config = currentConfig();
  if (!config || config.status !== "connected") {
    throw new OperationalError(
      "The Email connector is not ready. Test the Email integration before dispatching inbox automations.",
      "EMAIL_CONNECTOR_NOT_READY",
      503,
    );
  }
  const access = emailAccessRepository.getAgentEmailAccess(agentId);
  if (!access) {
    throw new OperationalError(
      "The assigned agent has no Email connector profile.",
      "EMAIL_CONNECTOR_NOT_READY",
      503,
    );
  }
  try {
    readEmailConnectorToken(access.tokenId);
  } catch {
    throw new OperationalError(
      "The assigned agent's Email connector token is unavailable. Save its Email access again to rotate the token.",
      "EMAIL_CONNECTOR_NOT_READY",
      503,
    );
  }
}

export async function getEmailIntegrationState(): Promise<EmailIntegrationState> {
  const config = currentConfig();
  const adminConfigured = Boolean(
    readSecret("SLAB_EMAIL_ADMIN_KEY", "SLAB_EMAIL_ADMIN_KEY_FILE"),
  );
  let accounts: EmailAccount[] = [];
  let gmailOAuth: GmailOAuthSettings = {
    configured: false,
    clientId: "",
    hasClientSecret: false,
    source: "missing",
    updatedAt: null,
  };
  let protonBridge: ManagedProtonBridgeState = {
    available: false,
    version: null,
    state: "unavailable",
    message: "Managed Proton Bridge status is unavailable.",
    accounts: [],
  };
  let microsoftOAuth: MicrosoftOAuthSettings = {
    configured: false,
    clientId: "",
    hasClientSecret: false,
    source: "missing",
    updatedAt: null,
    tenant: "common",
  };
  let lastError = config?.lastError ?? null;
  if ((config || process.env.SLAB_EMAIL_URL?.trim()) && adminConfigured) {
    try {
      const emailClient = new EmailAdminClient(currentServiceUrl());
      [accounts, gmailOAuth] = await Promise.all([
        emailClient.listAccounts(),
        emailClient.getGoogleOAuthSettings(),
      ]);
      try {
        microsoftOAuth = await emailClient.getMicrosoftOAuthSettings();
      } catch {
        // Preserve compatibility while slab-email rolls forward.
      }
      try {
        protonBridge = await emailClient.getManagedProtonBridgeStatus();
      } catch {
        // Older slab-email releases do not expose managed Bridge yet. Keep
        // existing account/Gmail management available during rolling updates.
      }
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "Email accounts could not be loaded.";
    }
  }
  return {
    configured: Boolean(config || process.env.SLAB_EMAIL_URL?.trim()),
    adminConfigured,
    serviceUrl: config?.serviceUrl ?? configuredServiceUrl(),
    status: config?.status ?? "not_tested",
    lastTestedAt: config?.lastTestedAt ?? null,
    lastError,
    gmailOAuth,
    microsoftOAuth,
    protonBridge,
    accounts,
    assignments: emailAccessRepository.listAgentEmailAccess(),
  };
}

export async function saveAndTestEmailIntegration(serviceUrl: string) {
  const normalized = normalizeEmailServiceUrl(serviceUrl);
  const testedAt = new Date().toISOString();
  try {
    await new EmailAdminClient(normalized).health();
    emailAccessRepository.saveEmailIntegration({
      serviceUrl: normalized,
      status: "connected",
      lastTestedAt: testedAt,
      lastError: null,
    });
  } catch (error) {
    emailAccessRepository.saveEmailIntegration({
      serviceUrl: normalized,
      status: "failed",
      lastTestedAt: testedAt,
      lastError:
        error instanceof Error
          ? error.message
          : "Email service connection failed.",
    });
  }
  return getEmailIntegrationState();
}

export async function testEmailIntegration() {
  return saveAndTestEmailIntegration(currentServiceUrl());
}

export function listInboundEmailEvents(after: number, limit = 100) {
  return client().listInboundEvents({ after, limit });
}

export async function getInboundEmailAccount(accountId: string) {
  const account = await client().getAccount(accountId);
  if (!account.enabled || !account.capabilities.read) {
    throw new OperationalError(
      "Choose an enabled Email account that supports reading messages.",
    );
  }
  return account;
}

export async function createEmailAccount(
  provider: "proton-bridge" | "imap-smtp" | "agentmail" | "resend",
  input: Record<string, unknown>,
) {
  const account = await client().createAccount(provider, input);
  return { account, state: await getEmailIntegrationState() };
}

export async function updateEmailAccount(
  accountId: string,
  input: Record<string, unknown>,
) {
  const account = await client().updateAccount(accountId, input);
  return { account, state: await getEmailIntegrationState() };
}

export async function testEmailAccount(accountId: string) {
  return client().testAccount(accountId);
}

export async function setEmailAccountEnabled(
  accountId: string,
  enabled: boolean,
) {
  await client().setAccountEnabled(accountId, enabled);
  return getEmailIntegrationState();
}

export async function deleteEmailAccount(accountId: string) {
  const accounts = await client().listAccounts();
  const account = accounts.find(({ id }) => id === accountId);
  if (!account) throw new OperationalError("Email account not found.");
  const isManagedPrimary =
    account.managed &&
    account.managedBridgeLogin?.toLowerCase() ===
      account.emailAddress.toLowerCase();
  const impactedAccountIds = new Set(
    isManagedPrimary
      ? accounts
          .filter(
            (candidate) =>
              candidate.managed &&
              candidate.managedBridgeLogin?.toLowerCase() ===
                account.managedBridgeLogin?.toLowerCase(),
          )
          .map(({ id }) => id)
      : [accountId],
  );
  if (
    emailAccessRepository
      .listAgentEmailAccess()
      .some(({ accountIds }) =>
        accountIds.some((id) => impactedAccountIds.has(id)),
      )
  ) {
    throw new OperationalError(
      "Remove every affected Proton sender from agent profiles before deleting this account.",
    );
  }
  if (account.managed)
    await client().deleteManagedProtonBridgeAccount(accountId);
  else await client().deleteAccount(accountId);
  return getEmailIntegrationState();
}

export async function connectManagedProtonBridge(input: {
  emailAddress: string;
  displayName: string;
  password: string;
}) {
  const setup = await client().connectManagedProtonBridge(input);
  return { setup, state: await getEmailIntegrationState() };
}

export async function continueManagedProtonBridge(input: {
  challengeId: string;
  value?: string;
}) {
  const setup = await client().continueManagedProtonBridge(input);
  return { setup, state: await getEmailIntegrationState() };
}

export async function abortManagedProtonBridge(challengeId: string) {
  await client().abortManagedProtonBridge(challengeId);
  return getEmailIntegrationState();
}

export async function syncManagedProtonBridgeAddresses(accountId: string) {
  const result = await client().syncManagedProtonBridgeAddresses(accountId);
  return { ...result, state: await getEmailIntegrationState() };
}

export function connectGmail(returnUrl: string) {
  return client().connectGmail(returnUrl);
}

export function connectMicrosoft(returnUrl: string) {
  return client().connectMicrosoft(returnUrl);
}

export function completeGmailConnection(code: string, state: string) {
  return client().completeGmail(code, state);
}

export function completeMicrosoftConnection(code: string, state: string) {
  return client().completeMicrosoft(code, state);
}

export async function saveGoogleOAuthSettings(input: {
  clientId: string;
  clientSecret?: string;
}) {
  await client().saveGoogleOAuthSettings(input);
  return getEmailIntegrationState();
}

export async function saveMicrosoftOAuthSettings(input: {
  clientId: string;
  clientSecret?: string;
  tenant: string;
}) {
  await client().saveMicrosoftOAuthSettings(input);
  return getEmailIntegrationState();
}

function validateAccess(input: {
  agentId: string;
  accountIds: string[];
  readEnabled: boolean;
  draftEnabled: boolean;
  sendEnabled: boolean;
  sendPolicy: EmailSendPolicy;
}) {
  const agent = agentRepository.getAgent(input.agentId);
  if (!agent) throw new OperationalError("Agent not found.");
  if (input.accountIds.length === 0) {
    throw new OperationalError("Select at least one Email account.");
  }
  if (!input.readEnabled && !input.draftEnabled && !input.sendEnabled) {
    throw new OperationalError("Enable at least one Email capability.");
  }
  if (input.sendPolicy === "disabled" && input.sendEnabled) {
    throw new OperationalError(
      "Send permission must be off when the send policy is disabled.",
    );
  }
  if (input.sendPolicy !== "disabled" && !input.sendEnabled) {
    throw new OperationalError(
      "Enable send permission or choose the disabled send policy.",
    );
  }
}

export async function saveAgentEmailAccess(input: {
  agentId: string;
  accountIds: string[];
  readEnabled: boolean;
  draftEnabled: boolean;
  sendEnabled: boolean;
  sendPolicy: EmailSendPolicy;
}): Promise<AgentEmailAccess> {
  validateAccess(input);
  const remoteAccounts = await client().listAccounts();
  const remoteIds = new Set(remoteAccounts.map(({ id }) => id));
  if (input.accountIds.some((id) => !remoteIds.has(id))) {
    throw new OperationalError(
      "One or more selected Email accounts no longer exist.",
    );
  }
  const selectedAccounts = remoteAccounts.filter(({ id }) =>
    input.accountIds.includes(id),
  );
  if (
    (input.readEnabled &&
      !selectedAccounts.some(({ capabilities }) => capabilities.read)) ||
    (input.draftEnabled &&
      !selectedAccounts.some(({ capabilities }) => capabilities.draft)) ||
    (input.sendEnabled &&
      !selectedAccounts.some(({ capabilities }) => capabilities.send))
  ) {
    throw new OperationalError(
      "One or more enabled Email permissions are unsupported by the selected accounts.",
    );
  }

  const agent = agentRepository.getAgent(input.agentId)!;
  const current = emailAccessRepository.getAgentEmailAccess(input.agentId);
  const profileInput = {
    name: `slab-agents:${agent.slug}`,
    readEnabled: input.readEnabled,
    draftEnabled: input.draftEnabled,
    sendEnabled: input.sendEnabled,
    accountIds: [...new Set(input.accountIds)],
  };
  const emailClient = client();
  let profile;
  if (current) {
    try {
      profile = await emailClient.updateProfile(
        current.profileId,
        profileInput,
      );
    } catch (error) {
      if (!String(error).includes("not found")) throw error;
      profile = await emailClient.createProfile(profileInput);
    }
  } else {
    profile = await emailClient.createProfile(profileInput);
  }

  let tokenId = current?.tokenId;
  let tokenPrefix = current?.tokenPrefix;
  let tokenCreatedAt = current?.tokenCreatedAt;
  let createdToken: { token: string; id: string; prefix: string } | null = null;
  try {
    if (tokenId) readEmailConnectorToken(tokenId);
  } catch {
    tokenId = undefined;
  }
  if (!tokenId || profile.id !== current?.profileId) {
    createdToken = await emailClient.createToken(profile.id);
    storeEmailConnectorToken(createdToken.id, createdToken.token);
    tokenId = createdToken.id;
    tokenPrefix = createdToken.prefix;
    tokenCreatedAt = new Date().toISOString();
  }

  try {
    const saved = emailAccessRepository.saveAgentEmailAccess({
      agentId: input.agentId,
      profileId: profile.id,
      profileName: profile.name,
      accountIds: profileInput.accountIds,
      readEnabled: input.readEnabled,
      draftEnabled: input.draftEnabled,
      sendEnabled: input.sendEnabled,
      sendPolicy: input.sendPolicy,
      tokenId: tokenId!,
      tokenPrefix: tokenPrefix!,
      tokenCreatedAt: tokenCreatedAt!,
    });
    if (createdToken && current?.tokenId) {
      if (current.profileId === profile.id) {
        await emailClient
          .revokeToken(profile.id, current.tokenId)
          .catch(() => undefined);
      }
      deleteEmailConnectorToken(current.tokenId);
    }
    return saved;
  } catch (error) {
    if (createdToken) {
      await emailClient
        .revokeToken(profile.id, createdToken.id)
        .catch(() => undefined);
      deleteEmailConnectorToken(createdToken.id);
    }
    throw error;
  }
}

export async function revokeAgentEmailAccess(agentId: string) {
  const current = emailAccessRepository.getAgentEmailAccess(agentId);
  if (!current) throw new OperationalError("Agent Email access was not found.");
  await client().revokeToken(current.profileId, current.tokenId);
  emailAccessRepository.deleteAgentEmailAccess(agentId);
  deleteEmailConnectorToken(current.tokenId);
}

export function getAgentEmailMcp(agentId: string) {
  const config = currentConfig();
  const access = emailAccessRepository.getAgentEmailAccess(agentId);
  if (!config || config.status !== "connected" || !access) return null;
  const bearerToken = readEmailConnectorToken(access.tokenId);
  return {
    name: "email" as const,
    url: `${config.serviceUrl}/mcp`,
    credentials: { bearerToken },
    approval: {
      defaultMode: "approve" as const,
      tools:
        access.sendPolicy === "approval_required"
          ? {
              email_send: "prompt" as const,
              email_reply: "prompt" as const,
            }
          : {},
    },
  };
}
