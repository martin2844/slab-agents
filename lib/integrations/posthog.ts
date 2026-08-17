import "server-only";

export type PostHogDatacenter = "us" | "eu";

const hosts: Record<PostHogDatacenter, string> = {
  us: "https://us.posthog.com",
  eu: "https://eu.posthog.com",
};

type JsonRecord = Record<string, unknown>;

function records(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value) && Array.isArray(value.results)) {
    return value.results.filter(isRecord);
  }
  return [];
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function request(
  datacenter: PostHogDatacenter,
  apiKey: string,
  pathname: string,
  init?: RequestInit,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${hosts[datacenter]}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail =
        isRecord(payload) && typeof payload.detail === "string"
          ? payload.detail
          : `PostHog returned ${response.status}.`;
      throw new Error(detail);
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("PostHog did not respond within 15 seconds.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function testPostHogConnection(
  datacenter: PostHogDatacenter,
  apiKey: string,
) {
  const organizations = records(
    await request(datacenter, apiKey, "/api/organizations/?limit=1"),
  );
  return { organizationCount: organizations.length };
}

export async function listPostHogProjects(
  datacenter: PostHogDatacenter,
  apiKey: string,
) {
  const organizations = records(
    await request(datacenter, apiKey, "/api/organizations/?limit=100"),
  );
  const projectGroups = await Promise.all(
    organizations.map(async (organization) => {
      const organizationId = String(organization.id ?? "");
      if (!organizationId) return [];
      const projects = records(
        await request(
          datacenter,
          apiKey,
          `/api/organizations/${encodeURIComponent(organizationId)}/projects/?limit=100`,
        ),
      );
      return projects.map((project) => ({
        id: project.id,
        name: project.name,
        organizationId,
        organizationName: organization.name,
      }));
    }),
  );
  return projectGroups.flat();
}

export async function queryPostHogAnalytics(
  datacenter: PostHogDatacenter,
  apiKey: string,
  projectId: string,
  query: string,
) {
  return request(
    datacenter,
    apiKey,
    `/api/projects/${encodeURIComponent(projectId)}/query/`,
    {
      method: "POST",
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    },
  );
}

export function posthogAppUrl(datacenter: PostHogDatacenter) {
  return hosts[datacenter];
}
