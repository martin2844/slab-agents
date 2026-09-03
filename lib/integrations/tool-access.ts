export const ALL_INTEGRATION_TOOLS = "*";

export function grantsAllIntegrationTools(toolKeys: readonly string[]) {
  return toolKeys.includes(ALL_INTEGRATION_TOOLS);
}

export function expandIntegrationToolGrants(
  grants: readonly string[],
  availableToolKeys: readonly string[],
) {
  const available = [...new Set(availableToolKeys)];
  if (grantsAllIntegrationTools(grants)) return available;
  const availableSet = new Set(available);
  return [...new Set(grants)].filter((toolKey) => availableSet.has(toolKey));
}

export function collapseCompleteIntegrationToolGrants(
  permissions: Record<string, string[]>,
  availableToolKeys: readonly string[],
) {
  if (availableToolKeys.length === 0) return permissions;
  return Object.fromEntries(
    Object.entries(permissions).map(([agentId, grants]) => [
      agentId,
      grantsAllIntegrationTools(grants) ||
      availableToolKeys.every((toolKey) => grants.includes(toolKey))
        ? [ALL_INTEGRATION_TOOLS]
        : grants,
    ]),
  );
}

export function integrationToolIsGranted(
  grants: readonly string[],
  ...toolKeys: string[]
) {
  return (
    grantsAllIntegrationTools(grants) ||
    toolKeys.some((toolKey) => grants.includes(toolKey))
  );
}
