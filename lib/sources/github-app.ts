import "server-only";

import { createHash, createSign, randomBytes } from "node:crypto";
import { badRequest, notFound } from "@/lib/api";
import { decryptLocalSecret, encryptLocalSecret } from "@/lib/secrets";
import { OperationalError } from "@/lib/operational-error";
import { sourceRepository } from "@/lib/repositories/source-repository";
import type { GitHubRepositoryOption } from "@/lib/types";

const GITHUB_API = "https://api.github.com";
const STATE_TTL_MS = 60 * 60_000;

function stateHash(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

function oneTimeState(appId: string, action: "manifest" | "install") {
  const state = randomBytes(32).toString("base64url");
  sourceRepository.saveGithubState({
    stateHash: stateHash(state),
    githubAppId: appId,
    action,
    expiresAt: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });
  return state;
}

async function githubJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(new URL(path, GITHUB_API), {
      ...init,
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Slab-Sources/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new OperationalError(
        `GitHub returned HTTP ${response.status}.`,
        response.status === 401 || response.status === 403
          ? "GITHUB_AUTH_FAILED"
          : "GITHUB_API_ERROR",
        502,
      );
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof OperationalError) throw error;
    throw new OperationalError(
      controller.signal.aborted
        ? "GitHub did not respond before the timeout."
        : "GitHub could not be reached.",
      controller.signal.aborted ? "GITHUB_TIMEOUT" : "GITHUB_UNAVAILABLE",
      controller.signal.aborted ? 504 : 502,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function appJwt(appId: string, encryptedPrivateKey: string) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId }),
  ).toString("base64url");
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(decryptLocalSecret(encryptedPrivateKey), "base64url")}`;
}

function requireRegisteredApp(id: string) {
  const app = sourceRepository.getGithubApp(id);
  if (!app) throw notFound("GitHub App connection not found.");
  if (!app.appId || !app.appSlug || !app.privateKeyCiphertext) {
    throw badRequest("Complete GitHub App registration first.");
  }
  return app;
}

export function createGithubAppManifest(input: {
  name: string;
  organization: string | null;
  origin: string;
}) {
  const app = sourceRepository.createGithubApp(input.name, input.organization);
  const state = oneTimeState(app.id, "manifest");
  const registeredName = `${input.name.slice(0, 24).trim()}-${randomBytes(4).toString("hex")}`;
  const manifest = {
    name: registeredName,
    url: input.origin,
    redirect_url: `${input.origin}/api/sources/github/callback/manifest`,
    setup_url: `${input.origin}/api/sources/github/callback/install`,
    public: false,
    default_permissions: { contents: "read", metadata: "read" },
    default_events: [] as string[],
  };
  const owner = input.organization
    ? `organizations/${encodeURIComponent(input.organization)}/settings`
    : "settings";
  return {
    app: { id: app.id, name: app.name, status: app.status },
    state,
    manifest,
    actionUrl: `https://github.com/${owner}/apps/new?state=${encodeURIComponent(state)}`,
  };
}

export async function completeGithubManifest(code: string, state: string) {
  const app = sourceRepository.consumeGithubState(stateHash(state), "manifest");
  if (!app)
    throw badRequest("GitHub registration state is invalid or expired.");
  const result = await githubJson<{
    id: number;
    slug: string;
    pem: string;
  }>(`/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: "POST",
  });
  const registered = sourceRepository.registerGithubApp({
    id: app.id,
    appId: String(result.id),
    appSlug: result.slug,
    privateKeyCiphertext: encryptLocalSecret(result.pem),
  });
  if (!registered)
    throw badRequest("GitHub App registration was already completed.");
  return registered;
}

export function githubInstallUrl(id: string) {
  const app = requireRegisteredApp(id);
  const state = oneTimeState(id, "install");
  return `https://github.com/apps/${encodeURIComponent(app.appSlug!)}/installations/new?state=${encodeURIComponent(state)}`;
}

export async function completeGithubInstallation(
  installationId: string,
  state: string,
) {
  const app = sourceRepository.consumeGithubState(stateHash(state), "install");
  if (!app?.appId || !app.privateKeyCiphertext) {
    throw badRequest("GitHub installation state is invalid or expired.");
  }
  const installation = await githubJson<{
    id: number;
    app_id: number;
    account?: { login?: string };
  }>(`/app/installations/${encodeURIComponent(installationId)}`, {
    headers: {
      Authorization: `Bearer ${appJwt(app.appId, app.privateKeyCiphertext)}`,
    },
  });
  if (String(installation.app_id) !== app.appId) {
    throw badRequest("This GitHub installation belongs to another App.");
  }
  return sourceRepository.installGithubApp({
    id: app.id,
    installationId: String(installation.id),
    accountLogin: installation.account?.login ?? "GitHub",
  });
}

export async function githubInstallationToken(id: string) {
  const app = requireRegisteredApp(id);
  if (!app.installationId) throw badRequest("Install the GitHub App first.");
  const result = await githubJson<{ token: string; expires_at: string }>(
    `/app/installations/${encodeURIComponent(app.installationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJwt(app.appId!, app.privateKeyCiphertext!)}`,
      },
    },
  );
  return result.token;
}

export async function listGithubAppRepositories(id: string) {
  const token = await githubInstallationToken(id);
  const repositories: GitHubRepositoryOption[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = await githubJson<{
      repositories?: Array<{
        id: number;
        full_name: string;
        default_branch: string;
        private: boolean;
      }>;
    }>(`/installation/repositories?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const rows = result.repositories ?? [];
    repositories.push(
      ...rows.map((repository) => ({
        id: repository.id,
        fullName: repository.full_name,
        defaultBranch: repository.default_branch,
        private: repository.private,
      })),
    );
    if (rows.length < 100) break;
    if (page === 10) {
      throw new OperationalError(
        "GitHub repository access exceeds the 1,000 repository discovery limit.",
        "GITHUB_COLLECTION_TOO_LARGE",
        400,
      );
    }
  }
  sourceRepository.verifyGithubApp(id, "connected", null);
  return repositories;
}

export async function verifyGithubApp(id: string) {
  try {
    const repositories = await listGithubAppRepositories(id);
    return { connected: true, repositoryCount: repositories.length };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "GitHub verification failed.";
    sourceRepository.verifyGithubApp(id, "error", message);
    throw error;
  }
}
