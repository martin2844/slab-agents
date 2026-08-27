import type {
  SystemUpdateChannel,
  SystemUpdatePolicy,
  SystemUpdateRequest,
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
