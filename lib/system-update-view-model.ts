import type {
  SystemUpdateChannel,
  SystemUpdateCheckResult,
  SystemUpdatePolicy,
  SystemUpdateRequest,
  SystemUpdatesData,
} from "./types";

function sameEditablePolicy(
  left: Pick<SystemUpdatePolicy, "enabled" | "checkHourUtc">,
  right: Pick<SystemUpdatePolicy, "enabled" | "checkHourUtc">,
) {
  return (
    left.enabled === right.enabled && left.checkHourUtc === right.checkHourUtc
  );
}

export function reconcileSystemUpdatePolicyDraft(
  draft: SystemUpdatePolicy,
  previousServerPolicy: SystemUpdatePolicy,
  nextServerPolicy: SystemUpdatePolicy,
) {
  const draftWasPristine =
    draft.version === previousServerPolicy.version &&
    sameEditablePolicy(draft, previousServerPolicy);
  return draftWasPristine || sameEditablePolicy(draft, nextServerPolicy)
    ? nextServerPolicy
    : draft;
}

export function deriveSystemUpdateChannelState(
  requests: SystemUpdateRequest[],
  channel: SystemUpdateChannel,
) {
  const latestSuccessfulCheck =
    requests.find(
      (request) =>
        request.action === "check" &&
        request.channel === channel &&
        request.state === "succeeded" &&
        request.result?.channel === channel,
    ) ?? null;
  const authorizingCheck =
    latestSuccessfulCheck?.source === "manual" ? latestSuccessfulCheck : null;
  const latestApply =
    requests.find(
      (request) => request.action === "apply" && request.channel === channel,
    ) ?? null;
  const authorizingCheckConsumed = Boolean(
    authorizingCheck && latestApply?.parentRequestId === authorizingCheck.id,
  );
  const applyIsTerminal =
    latestApply?.state === "succeeded" || latestApply?.state === "failed";
  const needsFreshCheck = Boolean(
    authorizingCheckConsumed && applyIsTerminal && !latestApply?.result,
  );
  const freshestInventory =
    requests.find(
      (request) =>
        request.state === "succeeded" && request.result?.channel === channel,
    ) ?? null;
  const inventoryRequest = needsFreshCheck ? null : freshestInventory;
  const applyTarget =
    !authorizingCheckConsumed &&
    authorizingCheck?.result?.status === "update_available"
      ? authorizingCheck.result.availableStackVersion
      : null;

  return {
    inventoryRequest,
    authorizingCheck,
    latestApply,
    needsFreshCheck,
    applyTarget,
  };
}

export function deriveSystemUpdateSidebarState(
  requests: SystemUpdateRequest[],
) {
  const stable = deriveSystemUpdateChannelState(requests, "stable");
  const freshestInventoryIndex = requests.findIndex(
    (request) => request.state === "succeeded" && request.result,
  );
  const uncertainApplyIndex = requests.findIndex(
    (request) =>
      request.action === "apply" &&
      (request.state === "succeeded" || request.state === "failed") &&
      !request.result,
  );
  const activeApplyIndex = requests.findIndex(
    (request) =>
      request.action === "apply" &&
      (request.state === "submitted" || request.state === "running"),
  );
  const applyIsNewerThanInventory = (index: number) =>
    index >= 0 &&
    (freshestInventoryIndex < 0 || index < freshestInventoryIndex);
  const versionIsUncertain = applyIsNewerThanInventory(uncertainApplyIndex);
  const freshestInventory = versionIsUncertain
    ? null
    : (requests[freshestInventoryIndex]?.result ?? null);
  const freshestInventoryRequest =
    freshestInventoryIndex >= 0 ? requests[freshestInventoryIndex] : null;
  const stableInventory = stable.inventoryRequest?.result ?? null;
  const stableInventoryIndex = stable.inventoryRequest
    ? requests.findIndex(({ id }) => id === stable.inventoryRequest?.id)
    : -1;

  if (applyIsNewerThanInventory(activeApplyIndex)) {
    return {
      installedVersion: null,
      attention: "update_in_progress" as const,
      statusLabel: "Update in progress",
    };
  }

  if (versionIsUncertain) {
    return {
      installedVersion: null,
      attention: "check_required" as const,
      statusLabel: "Fresh version check required",
    };
  }
  if (freshestInventory && inventoryNeedsRecovery(freshestInventory)) {
    return {
      installedVersion: freshestInventory.installedStackVersion,
      attention: "recovery_required" as const,
      statusLabel: "Recovery required",
    };
  }
  const newerCrossChannelInventory =
    freshestInventoryRequest &&
    stable.inventoryRequest &&
    freshestInventoryIndex < stableInventoryIndex &&
    freshestInventoryRequest.channel !== "stable";
  if (
    freshestInventory &&
    stableInventory &&
    newerCrossChannelInventory &&
    (freshestInventoryRequest.action === "apply" ||
      !sameInstalledInventory(freshestInventory, stableInventory) ||
      inventoryNeedsRecovery(freshestInventory) !==
        inventoryNeedsRecovery(stableInventory))
  ) {
    return {
      installedVersion: freshestInventory.installedStackVersion,
      attention: "check_required" as const,
      statusLabel: "Fresh stable check required",
    };
  }
  if (freshestInventory && (!stableInventory || stable.needsFreshCheck)) {
    return {
      installedVersion: freshestInventory.installedStackVersion,
      attention: "check_required" as const,
      statusLabel: "Fresh stable check required",
    };
  }
  if (stableInventory && inventoryNeedsRecovery(stableInventory)) {
    return {
      installedVersion: freshestInventory?.installedStackVersion ?? null,
      attention: "recovery_required" as const,
      statusLabel: "Recovery required",
    };
  }
  if (stableInventory?.status === "update_available") {
    return {
      installedVersion: freshestInventory?.installedStackVersion ?? null,
      attention: "update_available" as const,
      statusLabel: "Stable update available",
    };
  }
  return {
    installedVersion: freshestInventory?.installedStackVersion ?? null,
    attention: null,
    statusLabel: freshestInventory ? "Up to date" : "Version unknown",
  };
}

function inventoryNeedsRecovery(inventory: SystemUpdateCheckResult) {
  return (
    inventory.status === "recovery_required" ||
    Boolean(inventory.recoveryReason) ||
    inventory.components.some(({ status }) => status === "recovery_required")
  );
}

function sameInstalledInventory(
  left: SystemUpdateCheckResult,
  right: SystemUpdateCheckResult,
) {
  if (left.installedStackVersion !== right.installedStackVersion) return false;
  const rightComponents = new Map(
    right.components.map((component) => [component.id, component.installed]),
  );
  return left.components.every((component) => {
    const other = rightComponents.get(component.id);
    return (
      component.installed?.digest === other?.digest &&
      component.installed?.revision === other?.revision
    );
  });
}

export function describeAutomaticSystemUpdateDecision(
  request: SystemUpdateRequest,
  requests: SystemUpdateRequest[],
) {
  switch (request.automaticDecision) {
    case "apply_submitted": {
      const followUp = requests.find(
        ({ id }) => id === request.followUpRequestId,
      );
      return followUp?.target
        ? `Automatic apply ${followUp.target} was submitted as ${followUp.id}.`
        : "The automatic apply request was submitted to the host.";
    }
    case "up_to_date":
      return "No apply was needed because every component was already current.";
    case "unsafe": {
      if (request.result?.recoveryReason) return request.result.recoveryReason;
      if (request.result?.status === "channel_equivalent") {
        return "No automatic apply was needed because this channel resolves to the installed component set.";
      }
      if (request.result?.status === "channel_older") {
        return "Automatic apply stopped because this channel is older than the installed stack.";
      }
      if (request.result?.release.rollbackCompatibleFromInstalled === false) {
        return "Automatic apply stopped because rollback is incompatible with the installed release.";
      }
      const blockedComponents =
        request.result?.components
          .filter(({ status }) => status === "recovery_required")
          .map(({ name }) => name) ?? [];
      return blockedComponents.length
        ? `Automatic apply stopped because ${blockedComponents.join(", ")} require recovery.`
        : "Automatic apply stopped because the signed inventory did not pass every safety gate.";
    }
    case "not_applicable":
      return "Automatic updates were disabled when this completed stable check was evaluated.";
    default:
      return null;
  }
}

export class LatestResponseGate {
  private generation = 0;

  begin() {
    const generation = ++this.generation;
    return {
      isLatest: () => generation === this.generation,
    };
  }

  invalidate() {
    this.generation += 1;
  }
}

export class SystemUpdatesDataCoordinator {
  private readonly gate = new LatestResponseGate();

  beginRead() {
    return this.gate.begin();
  }

  commitRead(
    response: ReturnType<LatestResponseGate["begin"]>,
    next: SystemUpdatesData,
  ) {
    return response.isLatest() ? next : null;
  }

  seed(next: SystemUpdatesData) {
    this.gate.invalidate();
    return next;
  }

  invalidate() {
    this.gate.invalidate();
  }
}

export class SystemUpdateRefreshCoordinator {
  private readonly gate = new LatestResponseGate();
  private serverPolicy: SystemUpdatePolicy;
  private forcePolicySync = false;

  constructor(initialPolicy: SystemUpdatePolicy) {
    this.serverPolicy = initialPolicy;
  }

  begin() {
    return this.gate.begin();
  }

  invalidate() {
    this.gate.invalidate();
  }

  forceNextPolicySync() {
    this.forcePolicySync = true;
  }

  acceptPolicyMutation(policy: SystemUpdatePolicy) {
    this.invalidate();
    this.serverPolicy = policy;
    this.forcePolicySync = false;
  }

  commit(
    response: ReturnType<LatestResponseGate["begin"]>,
    nextPolicy: SystemUpdatePolicy,
  ) {
    if (!response.isLatest()) return null;
    const previousPolicy = this.serverPolicy;
    const forcePolicySync = this.forcePolicySync;
    this.serverPolicy = nextPolicy;
    this.forcePolicySync = false;
    return (draft: SystemUpdatePolicy) =>
      forcePolicySync
        ? nextPolicy
        : reconcileSystemUpdatePolicyDraft(draft, previousPolicy, nextPolicy);
  }
}
