import type { IntegrationAuthType } from "@/lib/types";
import { normalizeIntegrationToolKey } from "@/lib/integrations/naming";
import { IntegrationConfigurationError } from "@/lib/integrations/errors";

export function normalizeHttpIntegrationBaseUrl(value: string) {
  const parsed = new URL(value.trim());
  if (!parsed.protocol || !["http:", "https:"].includes(parsed.protocol)) {
    throw new IntegrationConfigurationError(
      "Only HTTP and HTTPS URLs are supported.",
    );
  }
  if (parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new IntegrationConfigurationError(
      "Base URL must not include query, hash, or credentials.",
    );
  }
  return parsed.toString().replace(/\/$/, "");
}

export function normalizeHttpOperationPath(path: string) {
  const value = path.trim();
  if (!value.startsWith("/")) {
    throw new IntegrationConfigurationError(
      "Operation path must start with '/'.",
    );
  }
  if (value.includes("..")) {
    throw new IntegrationConfigurationError(
      "Operation path cannot contain '..'.",
    );
  }
  if (/[^a-zA-Z0-9_\-/.{}]/.test(value)) {
    throw new IntegrationConfigurationError(
      "Operation path contains invalid characters.",
    );
  }
  return value;
}

export function normalizeHttpOperationKey(value: string) {
  return normalizeIntegrationToolKey(value);
}

export function extractHttpPathParameters(pathTemplate: string) {
  const items = new Set<string>();
  for (const match of pathTemplate.matchAll(/\{([a-zA-Z0-9_-]+)\}/g)) {
    items.add(match[1]!);
  }
  return [...items];
}

function normalizedAuthHeader(
  authType: IntegrationAuthType,
  headerName?: string | null,
) {
  if (authType !== "api_key_header") return null;
  return (headerName?.trim() || "X-API-Key").toLowerCase();
}

export function canReuseHttpCredential(
  previous: {
    baseUrl: string;
    authType: IntegrationAuthType;
    authHeaderName?: string | null;
  },
  next: {
    baseUrl: string;
    authType: IntegrationAuthType;
    authHeaderName?: string | null;
  },
) {
  if (previous.authType === "none" || next.authType === "none") return false;
  return (
    new URL(previous.baseUrl).origin === new URL(next.baseUrl).origin &&
    previous.authType === next.authType &&
    normalizedAuthHeader(previous.authType, previous.authHeaderName) ===
      normalizedAuthHeader(next.authType, next.authHeaderName)
  );
}
