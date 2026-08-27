import assert from "node:assert/strict";
import test from "node:test";
import {
  describeAutomaticSystemUpdateDecision,
  deriveSystemUpdateChannelState,
  LatestResponseGate,
  reconcileSystemUpdatePolicyDraft,
  SystemUpdateRefreshCoordinator,
} from "../lib/system-update-view-model.ts";

function inventory(version, status = "update_available") {
  return {
    channel: "stable",
    status,
    availableStackVersion: version,
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
