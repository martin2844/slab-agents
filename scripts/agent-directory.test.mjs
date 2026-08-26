import assert from "node:assert/strict";
import test from "node:test";

import { createWorkCoordinationContext } from "../lib/agent-directory.ts";

const agent = (overrides = {}) => ({
  id: "agent-clara",
  name: "Clara",
  slug: "clara",
  role: "Sales Assistant & Follow-up",
  enabled: true,
  fullAccess: true,
  ...overrides,
});

test("the agent directory is derived automatically from current enabled agents", () => {
  const initial = createWorkCoordinationContext({ agents: [agent()] });
  const afterCreate = createWorkCoordinationContext({
    agents: [
      agent(),
      agent({
        id: "agent-vera",
        name: "Vera",
        slug: "vera",
        role: "Customer Support & Inquiries",
      }),
    ],
  });

  assert.deepEqual(
    initial.directory.entries.map(({ slug }) => slug),
    ["clara"],
  );
  assert.deepEqual(
    afterCreate.directory.entries.map(({ slug }) => slug),
    ["clara", "vera"],
  );
  assert.match(afterCreate.directoryInstructions, /`clara`.*Follow-up/);
  assert.match(afterCreate.directoryInstructions, /`vera`.*Support/);
});

test("the directory includes only capabilities actually assigned at run start", () => {
  const context = createWorkCoordinationContext({
    agents: [agent(), agent({ id: "disabled", enabled: false })],
    integrations: [
      {
        name: "Clasificar Metrics",
        enabled: true,
        status: "connected",
        permissions: { "agent-clara": ["get_usage"] },
        secret: "must-not-leak",
      },
      {
        name: "Broken CRM",
        enabled: true,
        status: "failed",
        permissions: { "agent-clara": ["search"] },
      },
    ],
    emailAccess: [
      {
        agentId: "agent-clara",
        readEnabled: true,
        draftEnabled: true,
        sendEnabled: true,
        sendPolicy: "approval_required",
        token: "must-not-leak",
      },
    ],
  });

  assert.equal(context.directory.entries.length, 1);
  assert.deepEqual(context.directory.entries[0].integrations, [
    "Clasificar Metrics",
  ]);
  assert.deepEqual(context.directory.entries[0].email, {
    read: true,
    draft: true,
    send: true,
    sendPolicy: "approval_required",
  });
  assert.match(
    context.directoryInstructions,
    /Email \(read, draft, send; approval required\)/,
  );
  assert.doesNotMatch(context.instructions, /must-not-leak|Broken CRM/);
});

test("delegation instructions require exact enabled slugs", () => {
  const context = createWorkCoordinationContext({ agents: [agent()] });

  assert.match(context.coordinationInstructions, /use an exact slug/i);
  assert.match(context.coordinationInstructions, /Never invent an agent slug/);
  assert.match(context.coordinationInstructions, /`followups`/);
  assert.doesNotMatch(
    context.directory.entries.map(({ slug }) => slug).join(","),
    /followups/,
  );
});

test("email capabilities disappear when the connector is unavailable", () => {
  const context = createWorkCoordinationContext({
    agents: [agent()],
    emailConnected: false,
    emailAccess: [
      {
        agentId: "agent-clara",
        readEnabled: true,
        draftEnabled: true,
        sendEnabled: true,
        sendPolicy: "autonomous",
      },
    ],
  });

  assert.equal(context.directory.entries[0].email, null);
  assert.doesNotMatch(context.directoryInstructions, /Email/);
});
