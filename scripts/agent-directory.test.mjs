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

test("the directory reports granular Work and Docs policies truthfully", () => {
  const context = createWorkCoordinationContext({
    agents: [agent({ fullAccess: false })],
    toolPolicies: [
      {
        agentId: "agent-clara",
        serverName: "work",
        defaultMode: "deny",
        tools: { assign_issue: "approve" },
      },
      {
        agentId: "someone-else",
        serverName: "docs",
        defaultMode: "deny",
        tools: {},
      },
    ],
  });

  assert.equal(context.directory.entries[0].workDocsWrites, "custom_per_tool");
  assert.match(context.directoryInstructions, /writes custom per tool/);
});

test("deny-all policies remove unavailable connector capabilities", () => {
  const context = createWorkCoordinationContext({
    agents: [agent()],
    integrations: [
      {
        name: "Operations calendar",
        serverName: "calendar_operations",
        enabled: true,
        status: "connected",
        permissions: {
          "agent-clara": ["calendar_list_events", "calendar_create_event"],
        },
      },
    ],
    emailAccess: [
      {
        agentId: "agent-clara",
        readEnabled: true,
        draftEnabled: true,
        sendEnabled: true,
        sendPolicy: "autonomous",
      },
    ],
    toolPolicies: [
      {
        agentId: "agent-clara",
        serverName: "email",
        defaultMode: "deny",
        tools: {},
      },
      {
        agentId: "agent-clara",
        serverName: "calendar_operations",
        defaultMode: "deny",
        tools: {},
      },
    ],
  });

  assert.doesNotMatch(
    context.directoryInstructions,
    /Email|Operations calendar/,
  );
});

test("an Email Ask override is not advertised as autonomous sending", () => {
  const context = createWorkCoordinationContext({
    agents: [agent()],
    emailAccess: [
      {
        agentId: "agent-clara",
        readEnabled: false,
        draftEnabled: false,
        sendEnabled: true,
        sendPolicy: "autonomous",
      },
    ],
    toolPolicies: [
      {
        agentId: "agent-clara",
        serverName: "email",
        defaultMode: "deny",
        tools: { email_send: "prompt" },
      },
    ],
  });

  assert.match(
    context.directoryInstructions,
    /Email \(send; approval required\)/,
  );
  assert.doesNotMatch(context.directoryInstructions, /send; autonomous/);
});

test("deny-all Work and Docs policies suppress coordination claims", () => {
  const context = createWorkCoordinationContext({
    agents: [agent()],
    coreTools: {
      work: [
        { name: "get_issue", readOnly: true },
        { name: "assign_issue", readOnly: false },
      ],
      docs: [
        { name: "get_doc", readOnly: true },
        { name: "update_doc", readOnly: false },
      ],
    },
    currentRunWorkTools: [],
    toolPolicies: [
      {
        agentId: "agent-clara",
        serverName: "work",
        defaultMode: "deny",
        tools: {},
      },
      {
        agentId: "agent-clara",
        serverName: "docs",
        defaultMode: "deny",
        tools: {},
      },
    ],
  });

  assert.match(context.directoryInstructions, /No granted tools/);
  assert.doesNotMatch(context.directoryInstructions, /Work \+ Docs/);
  assert.match(context.coordinationInstructions, /unavailable in this run/);
  assert.doesNotMatch(
    context.coordinationInstructions,
    /Assigning a Work item.*starts/i,
  );
});

test("legacy guarded writes remain approval-required with the core catalog", () => {
  const context = createWorkCoordinationContext({
    agents: [agent({ fullAccess: false })],
    coreTools: {
      work: [{ name: "assign_issue", readOnly: false }],
      docs: [{ name: "update_doc", readOnly: false }],
    },
  });

  assert.equal(
    context.directory.entries[0].workDocsWrites,
    "approval_required",
  );
});

test("run-scoped tools hide connectors added after the snapshot", () => {
  const context = createWorkCoordinationContext({
    agents: [agent()],
    currentAgentId: "agent-clara",
    currentRunToolsByServer: {
      work: ["get_issue"],
      docs: ["get_doc"],
    },
    integrations: [
      {
        name: "New calendar",
        serverName: "calendar_new",
        enabled: true,
        status: "connected",
        permissions: { "agent-clara": ["calendar_list_events"] },
      },
    ],
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

  assert.deepEqual(context.directory.entries[0].integrations, []);
  assert.equal(context.directory.entries[0].email, null);
  assert.doesNotMatch(context.directoryInstructions, /New calendar|Email/);
});

test("run instructions name every integration tool in the current capability snapshot", () => {
  const context = createWorkCoordinationContext({
    agents: [agent({ id: "agent-vera", name: "Vera", slug: "vera" })],
    currentAgentId: "agent-vera",
    currentRunToolsByServer: {
      custom_http_agent_metrics_api: ["agent_metrics_api__get_prices"],
    },
    integrations: [
      {
        name: "Clasificar Agent metrics API",
        serverName: "custom_http_agent_metrics_api",
        enabled: true,
        status: "connected",
        permissions: {
          "agent-vera": ["agent_metrics_api__get_prices"],
        },
      },
    ],
  });

  assert.match(
    context.directoryInstructions,
    /Current agent integration tools in this run \(authoritative snapshot\)/,
  );
  assert.match(
    context.directoryInstructions,
    /Clasificar Agent metrics API: `agent_metrics_api__get_prices`/,
  );
  assert.match(
    context.directoryInstructions,
    /Treat listed tools as available for this run/,
  );
});
