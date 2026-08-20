import "server-only";

import {
  EmailAdminClient,
  normalizeEmailServiceUrl,
} from "@/lib/integrations/email-client";
import {
  deleteEmailConnectorToken,
  readEmailConnectorToken,
  storeEmailConnectorToken,
} from "@/lib/integrations/email-token-vault";
import { repository } from "@/lib/repository";
import { readSecret } from "@/lib/server-config";
import type {
  AgentEmailAccess,
  EmailAccount,
  EmailIntegrationState,
  EmailSendPolicy,
} from "@/lib/types";

const DEFAULT_EMAIL_URL = "http://127.0.0.1:6981";

function currentConfig() {
  return repository.getEmailIntegrationRecord();
}

function client() {
  const config = currentConfig();
  if (!config) throw new Error("Configure the Email service URL first.");
  return new EmailAdminClient(config.serviceUrl);
}

export async function getEmailIntegrationState(): Promise<EmailIntegrationState> {
  const config = currentConfig();
  const adminConfigured = Boolean(
    readSecret("SLAB_EMAIL_ADMIN_KEY", "SLAB_EMAIL_ADMIN_KEY_FILE"),
  );
  let accounts: EmailAccount[] = [];
  let lastError = config?.lastError ?? null;
  if (config && adminConfigured) {
    try {
      accounts = await new EmailAdminClient(config.serviceUrl).listAccounts();
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "Email accounts could not be loaded.";
    }
  }
  return {
    configured: Boolean(config),
    adminConfigured,
    serviceUrl: config?.serviceUrl ?? DEFAULT_EMAIL_URL,
    status: config?.status ?? "not_tested",
    lastTestedAt: config?.lastTestedAt ?? null,
    lastError,
    accounts,
    assignments: repository.listAgentEmailAccess(),
  };
}

export async function saveAndTestEmailIntegration(serviceUrl: string) {
  const normalized = normalizeEmailServiceUrl(serviceUrl);
  const testedAt = new Date().toISOString();
  try {
    await new EmailAdminClient(normalized).health();
    repository.saveEmailIntegration({
      serviceUrl: normalized,
      status: "connected",
      lastTestedAt: testedAt,
      lastError: null,
    });
  } catch (error) {
    repository.saveEmailIntegration({
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
  const config = currentConfig();
  if (!config) throw new Error("Configure the Email service URL first.");
  return saveAndTestEmailIntegration(config.serviceUrl);
}

export async function createEmailAccount(
  provider: "proton-bridge" | "imap-smtp",
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
  if (
    repository
      .listAgentEmailAccess()
      .some(({ accountIds }) => accountIds.includes(accountId))
  ) {
    throw new Error(
      "Remove this account from every agent profile before deleting it.",
    );
  }
  await client().deleteAccount(accountId);
  return getEmailIntegrationState();
}

export function connectGmail(returnUrl: string) {
  return client().connectGmail(returnUrl);
}

export function completeGmailConnection(code: string, state: string) {
  return client().completeGmail(code, state);
}

function validateAccess(input: {
  agentId: string;
  accountIds: string[];
  readEnabled: boolean;
  draftEnabled: boolean;
  sendEnabled: boolean;
  sendPolicy: EmailSendPolicy;
}) {
  const agent = repository.getAgent(input.agentId);
  if (!agent) throw new Error("Agent not found.");
  if (input.accountIds.length === 0) {
    throw new Error("Select at least one Email account.");
  }
  if (!input.readEnabled && !input.draftEnabled && !input.sendEnabled) {
    throw new Error("Enable at least one Email capability.");
  }
  if (input.sendPolicy === "disabled" && input.sendEnabled) {
    throw new Error(
      "Send permission must be off when the send policy is disabled.",
    );
  }
  if (input.sendPolicy !== "disabled" && !input.sendEnabled) {
    throw new Error(
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
    throw new Error("One or more selected Email accounts no longer exist.");
  }

  const agent = repository.getAgent(input.agentId)!;
  const current = repository.getAgentEmailAccess(input.agentId);
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
    const saved = repository.saveAgentEmailAccess({
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
  const current = repository.getAgentEmailAccess(agentId);
  if (!current) throw new Error("Agent Email access was not found.");
  await client().revokeToken(current.profileId, current.tokenId);
  repository.deleteAgentEmailAccess(agentId);
  deleteEmailConnectorToken(current.tokenId);
}

export function getAgentEmailMcp(agentId: string) {
  const config = currentConfig();
  const access = repository.getAgentEmailAccess(agentId);
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
