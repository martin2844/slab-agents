import assert from "node:assert/strict";
import test from "node:test";
import {
  describeAutomaticSystemUpdateDecision,
  deriveSystemUpdateChannelState,
  deriveSystemUpdateSidebarState,
  LatestResponseGate,
  reconcileSystemUpdatePolicyDraft,
  SystemUpdatesDataCoordinator,
  SystemUpdateRefreshCoordinator,
} from "../lib/system-update-view-model.ts";

function inventory(version, status = "update_available") {
  return {
    channel: "stable",
    status,
    installedStackVersion: "1.0.0",
    availableStackVersion: version,
    components: [],
  };
}

function request(overrides) {
  return {
    id: crypto.randomUUID(),
    action: "check",
    channel: "stable",
    source: "manual",
    state: "succeeded",
    parentRequestId: null,
    result: null,
    ...overrides,
  };
}

test("a successful apply replaces its authorizing inventory", () => {
  const check = request({ result: inventory("1.2.0") });
  const applied = request({
    action: "apply",
    parentRequestId: check.id,
    result: inventory("1.2.0", "up_to_date"),
  });

  const state = deriveSystemUpdateChannelState([applied, check], "stable");
  assert.equal(state.inventoryRequest.id, applied.id);
  assert.equal(state.applyTarget, null);
  assert.equal(state.needsFreshCheck, false);
});

test("a terminal apply without inventory requires a fresh check", () => {
  for (const state of ["succeeded", "failed"]) {
    const check = request({ result: inventory("1.2.0") });
    const applied = request({
      action: "apply",
      state,
      parentRequestId: check.id,
    });

    const derived = deriveSystemUpdateChannelState([applied, check], "stable");
    assert.equal(derived.inventoryRequest, null);
    assert.equal(derived.applyTarget, null);
    assert.equal(derived.needsFreshCheck, true);
  }
});

test("a newer check authorizes one new exact target after an uncertain apply", () => {
  const oldCheck = request({ result: inventory("1.2.0") });
  const failedApply = request({
    action: "apply",
    state: "failed",
    parentRequestId: oldCheck.id,
  });
  const freshCheck = request({ result: inventory("1.2.1") });

  const state = deriveSystemUpdateChannelState(
    [freshCheck, failedApply, oldCheck],
    "stable",
  );
  assert.equal(state.inventoryRequest.id, freshCheck.id);
  assert.equal(state.applyTarget, "1.2.1");
  assert.equal(state.needsFreshCheck, false);
});

test("scheduled checks remain exclusively owned by the automatic updater", () => {
  const scheduledCheck = request({
    source: "scheduled",
    result: inventory("1.2.0"),
  });

  const state = deriveSystemUpdateChannelState([scheduledCheck], "stable");
  assert.equal(state.inventoryRequest.id, scheduledCheck.id);
  assert.equal(state.authorizingCheck, null);
  assert.equal(state.applyTarget, null);
});

test("sidebar status shows a trustworthy version and stable update attention", () => {
  const update = request({ result: inventory("1.2.0") });
  assert.deepEqual(deriveSystemUpdateSidebarState([update]), {
    installedVersion: "1.0.0",
    attention: "update_available",
    statusLabel: "Stable update available",
  });

  const current = request({ result: inventory("1.0.0", "up_to_date") });
  assert.deepEqual(deriveSystemUpdateSidebarState([current]), {
    installedVersion: "1.0.0",
    attention: null,
    statusLabel: "Up to date",
  });
});

test("sidebar refuses to show a stale version after an uncertain apply", () => {
  const check = request({ result: inventory("1.2.0") });
  const uncertainApply = request({
    action: "apply",
    state: "failed",
    parentRequestId: check.id,
  });

  assert.deepEqual(deriveSystemUpdateSidebarState([uncertainApply, check]), {
    installedVersion: null,
    attention: "check_required",
    statusLabel: "Fresh version check required",
  });
});

test("polling syncs pristine policy drafts but preserves a dirty base version", () => {
  const original = {
    version: 1,
    enabled: false,
    checkHourUtc: 3,
  };
  const external = { ...original, version: 2, enabled: true };

  assert.equal(
    reconcileSystemUpdatePolicyDraft(original, original, external),
    external,
  );

  const dirty = { ...original, checkHourUtc: 7 };
  assert.equal(
    reconcileSystemUpdatePolicyDraft(dirty, original, external),
    dirty,
  );
  assert.equal(dirty.version, 1);
});

test("only the newest overlapping refresh may commit", async () => {
  const gate = new LatestResponseGate();
  let resolveOld;
  let resolveNew;
  const oldResponse = new Promise((resolve) => {
    resolveOld = resolve;
  });
  const newResponse = new Promise((resolve) => {
    resolveNew = resolve;
  });
  let visible = "initial";

  const consume = async (promise) => {
    const response = gate.begin();
    const value = await promise;
    if (response.isLatest()) visible = value;
  };
  const oldRead = consume(oldResponse);
  const newRead = consume(newResponse);
  resolveNew("new");
  await newRead;
  resolveOld("old");
  await oldRead;

  assert.equal(visible, "new");

  const pendingResponse = gate.begin();
  gate.invalidate();
  assert.equal(pendingResponse.isLatest(), false);
});

test("a System page seed supersedes cached sidebar data and stale reads", () => {
  const coordinator = new SystemUpdatesDataCoordinator();
  const cached = { marker: "cached" };
  const serverRendered = { marker: "server-rendered" };
  const pendingRead = coordinator.beginRead();
  let visible = cached;

  visible = coordinator.seed(serverRendered);

  assert.equal(coordinator.commitRead(pendingRead, cached), null);
  assert.equal(visible, serverRendered);
});

test("refresh reconciliation captures the previous policy before React runs its updater", () => {
  const original = { version: 1, enabled: false, checkHourUtc: 3 };
  const external = { version: 2, enabled: true, checkHourUtc: 8 };
  const coordinator = new SystemUpdateRefreshCoordinator(original);
  const response = coordinator.begin();
  const reconcileDraft = coordinator.commit(response, external);

  assert.ok(reconcileDraft);
  assert.equal(reconcileDraft(original), external);
});

test("a superseding poll still force-adopts policy after a version conflict", () => {
  const original = { version: 1, enabled: false, checkHourUtc: 3 };
  const dirty = { ...original, checkHourUtc: 7 };
  const external = { version: 2, enabled: true, checkHourUtc: 8 };
  const coordinator = new SystemUpdateRefreshCoordinator(original);

  coordinator.forceNextPolicySync();
  const conflictRefresh = coordinator.begin();
  const supersedingPoll = coordinator.begin();
  assert.equal(coordinator.commit(conflictRefresh, external), null);
  const reconcileDraft = coordinator.commit(supersedingPoll, external);

  assert.ok(reconcileDraft);
  assert.equal(reconcileDraft(dirty), external);
});

test("automatic decision copy reflects equivalent and older channel truth", () => {
  for (const [status, expected] of [
    ["channel_equivalent", /resolves to the installed component set/],
    ["channel_older", /older than the installed stack/],
  ]) {
    const check = request({
      automaticDecision: "unsafe",
      result: inventory("1.2.0", status),
    });
    assert.match(
      describeAutomaticSystemUpdateDecision(check, [check]),
      expected,
    );
  }

  const ineligible = request({
    source: "scheduled",
    automaticDecision: "not_applicable",
    result: inventory("1.2.0"),
  });
  assert.match(
    describeAutomaticSystemUpdateDecision(ineligible, [ineligible]),
    /Automatic updates were disabled/,
  );
});

test("sidebar does not present the pre-apply version during host mutation", () => {
  for (const state of ["submitted", "running"]) {
    const check = request({ result: inventory("1.2.0") });
    const activeApply = request({
      action: "apply",
      state,
      parentRequestId: check.id,
    });

    assert.deepEqual(deriveSystemUpdateSidebarState([activeApply, check]), {
      installedVersion: null,
      attention: "update_in_progress",
      statusLabel: "Update in progress",
    });
  }
});

test("newer candidate state invalidates an older stable conclusion", () => {
  const stableCheck = request({ result: inventory("1.1.0") });
  const candidateApply = request({
    action: "apply",
    channel: "candidate",
    result: {
      ...inventory("1.2.0", "up_to_date"),
      channel: "candidate",
      installedStackVersion: "1.2.0",
    },
  });

  assert.deepEqual(
    deriveSystemUpdateSidebarState([candidateApply, stableCheck]),
    {
      installedVersion: "1.2.0",
      attention: "check_required",
      statusLabel: "Fresh stable check required",
    },
  );
});

test("freshest recovery state wins across release channels", () => {
  const stableCheck = request({ result: inventory("1.0.0", "up_to_date") });
  const candidateRecovery = request({
    channel: "candidate",
    result: {
      ...inventory("1.2.0", "recovery_required"),
      channel: "candidate",
      recoveryReason: "Interrupted candidate update requires recovery.",
    },
  });

  assert.deepEqual(
    deriveSystemUpdateSidebarState([candidateRecovery, stableCheck]),
    {
      installedVersion: "1.0.0",
      attention: "recovery_required",
      statusLabel: "Recovery required",
    },
  );
});

test("newer healthy cross-channel inventory invalidates an older recovery conclusion", () => {
  const stableRecovery = request({
    result: {
      ...inventory("1.0.0", "recovery_required"),
      recoveryReason: "Interrupted stable update requires recovery.",
    },
  });
  const candidateHealthy = request({
    channel: "candidate",
    result: {
      ...inventory("1.0.0", "up_to_date"),
      channel: "candidate",
    },
  });

  assert.deepEqual(
    deriveSystemUpdateSidebarState([candidateHealthy, stableRecovery]),
    {
      installedVersion: "1.0.0",
      attention: "check_required",
      statusLabel: "Fresh stable check required",
    },
  );
});
