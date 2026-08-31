import assert from "node:assert/strict";
import test from "node:test";
import {
  blueprintResourceHref,
  blueprintTestStatus,
} from "../lib/packs/presentation.ts";

function resource(overrides) {
  return {
    id: "resource-id",
    packId: "example",
    resourceType: "agent",
    resourceKey: "agent",
    resourceId: "local-resource-id",
    managed: true,
    createdByPack: true,
    reattachable: false,
    state: "applied",
    baseline: {},
    lastError: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

test("Blueprint quick actions link to their owning Agent even when keys contain dots", () => {
  const agents = [
    resource({ resourceKey: "sales", resourceId: "short-agent" }),
    resource({ resourceKey: "sales.followup", resourceId: "owner-agent" }),
  ];
  const action = resource({
    resourceType: "quick_action",
    resourceKey: "sales.followup.send",
    resourceId: "quick-action",
  });

  assert.equal(
    blueprintResourceHref(action, [...agents, action]),
    "/agents/owner-agent",
  );
});

test("Blueprint test statuses use product language", () => {
  assert.equal(blueprintTestStatus(null), "not tested");
  assert.equal(blueprintTestStatus({ status: "running" }), "testing");
  assert.equal(blueprintTestStatus({ status: "passed" }), "passed");
});
