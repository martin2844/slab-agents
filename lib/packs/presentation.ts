import type {
  OperatorPackAcceptance,
  OperatorPackResource,
  OperatorPackSummary,
} from "../types";

export const activeBlueprintTestStatuses = new Set([
  "preparing",
  "queued",
  "running",
  "evaluating",
]);

// Product positioning is intentionally separate from the versioned install
// manifest so copy improvements do not create a package update.
const officialOutcomes: Record<string, string> = {
  "founder-ops":
    "Run structured operating reviews and turn company context into focused priorities.",
  "sales-ops":
    "Keep the commercial pipeline moving and close outstanding sales work.",
  "engineering-ops":
    "Investigate engineering blockers and keep delivery work moving.",
};

const capabilityNames: Record<string, string> = {
  work: "Work",
  docs: "Docs",
  email: "Email",
  calendar: "Calendar",
  crm: "CRM",
  metrics: "Business metrics",
  product_analytics: "Product analytics",
  error_monitoring: "Error monitoring",
  github: "GitHub",
};

export function blueprintOutcome(pack: OperatorPackSummary) {
  return officialOutcomes[pack.manifest.id] ?? pack.manifest.outcome;
}

export function hasActiveBlueprintInstallation(pack: OperatorPackSummary) {
  return Boolean(pack.installation && pack.installation.status !== "disabled");
}

export function blueprintStatus(pack: OperatorPackSummary) {
  if (!hasActiveBlueprintInstallation(pack)) return "available";
  if (pack.updateAvailable) return "update available";
  if (pack.installation?.status === "installed" && !pack.configured) {
    return "needs setup";
  }
  return pack.installation?.status ?? "available";
}

export function blueprintTestStatus(acceptance: OperatorPackAcceptance | null) {
  if (!acceptance) return "not tested";
  if (activeBlueprintTestStatuses.has(acceptance.status)) return "testing";
  return acceptance.status;
}

export function capabilityName(category: string) {
  return capabilityNames[category] ?? category.replaceAll("_", " ");
}

export function capabilitySettingsHref(category: string) {
  if (category === "work" || category === "docs") {
    return "/settings?tab=connections";
  }
  if (category === "email") return "/settings?tab=email";
  if (category === "calendar") return "/settings?tab=calendar";
  return "/integrations";
}

export function firstUsefulLine(value: string) {
  const line = value
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith("#"));
  if (!line) return "Included operating context for this Blueprint.";
  return line.replace(/^[-*]\s+/, "");
}

export function blueprintResourceTypeLabel(
  type: OperatorPackResource["resourceType"],
) {
  if (type === "agent") return "Agent";
  if (type === "quick_action") return "Agent action";
  if (type === "automation") return "Automation";
  if (type === "doc") return "Guide";
  return "Resource";
}

export function blueprintResourceHref(
  resource: OperatorPackResource,
  resources: OperatorPackResource[],
) {
  if (!resource.resourceId) return null;
  if (resource.resourceType === "agent") {
    return `/agents/${encodeURIComponent(resource.resourceId)}`;
  }
  if (resource.resourceType === "automation") {
    return `/automations/${encodeURIComponent(resource.resourceId)}`;
  }
  if (resource.resourceType === "doc") {
    return `/docs?doc=${encodeURIComponent(resource.resourceId)}`;
  }
  const agent = resources
    .filter(
      (candidate) =>
        candidate.resourceType === "agent" &&
        resource.resourceKey.startsWith(`${candidate.resourceKey}.`),
    )
    .sort(
      (left, right) => right.resourceKey.length - left.resourceKey.length,
    )[0];
  return agent?.resourceId
    ? `/agents/${encodeURIComponent(agent.resourceId)}`
    : null;
}
