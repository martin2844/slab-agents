import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  evaluateOperatorPackAcceptance,
  findAcceptanceAssignmentRun,
} from "../lib/packs/acceptance.ts";
import {
  comparePackVersions,
  decidePackResourceChange,
  samePackSnapshot,
} from "../lib/packs/lifecycle.ts";
import { parseOperatorPackManifest } from "../lib/packs/manifest.ts";

const baseManifest = {
  schemaVersion: 1,
  id: "test-ops",
  version: "1.0.0",
  name: "Test Ops",
  author: "Test",
  description: "A declarative test pack with no executable configuration.",
  outcome: "Create a repeatable test Agent and a durable local configuration.",
  compatibility: { minimumSlabVersion: "0.1.0" },
  agents: [
    {
      key: "operator",
      name: "Test Operator",
      slug: "test-operator",
      role: "Test operator",
      instructions: "Use only the explicit fixtures and record the result.",
      model: "default",
      enabled: true,
      fullAccess: false,
      quickActions: [
        {
          key: "inspect",
          label: "Inspect fixture",
          prompt:
            "Inspect the current synthetic fixture and record the result.",
        },
      ],
    },
  ],
  automations: [
    {
      key: "weekly",
      agentKey: "operator",
      name: "Weekly test review",
      mode: "review",
      cronExpression: "0 8 * * 1",
      prompt: "Review the synthetic fixtures and record only material changes.",
      enabled: false,
    },
  ],
  capabilities: [
    {
      category: "work",
      required: true,
      description: "Synthetic Work fixtures and durable outcomes.",
    },
  ],
  permissions: [],
  workConventions: ["Do not create unrelated Work."],
  docs: [],
  acceptanceScenarios: [
    {
      id: "synthetic-review",
      title: "Review a synthetic fixture",
      description: "Reads and updates a synthetic fixture deterministically.",
      agentKey: "operator",
      execution: "assignment",
      fixture: {
        issueTitle: "Synthetic issue",
        issueDescription:
          "Read the fixture, record the result, and mark it done.",
        priority: "medium",
      },
      prompt:
        "Read the synthetic fixture and record the durable result in Work.",
      rubric: {
        requiresWorkRead: true,
        requiresDocsRead: false,
        requiresWorkWrite: true,
        expectedIssueStatus: "done",
        maxCreatedWorkItems: 0,
      },
    },
  ],
  upgradeNotes: [],
};

test("Operator Pack manifest is strict, referential, and credential-free", () => {
  assert.equal(parseOperatorPackManifest(baseManifest).id, "test-ops");

  for (const forbidden of [
    { credentials: { token: "secret" } },
    { command: "curl example.test" },
    { hiddenPromptUrl: "https://example.test/prompt" },
  ]) {
    assert.throws(() =>
      parseOperatorPackManifest({ ...baseManifest, ...forbidden }),
    );
  }

  assert.throws(() =>
    parseOperatorPackManifest({
      ...baseManifest,
      automations: [
        { ...baseManifest.automations[0], agentKey: "missing-agent" },
      ],
    }),
  );
  assert.throws(() =>
    parseOperatorPackManifest({
      ...baseManifest,
      agents: [{ ...baseManifest.agents[0], fullAccess: true }],
    }),
  );
  assert.throws(() =>
    parseOperatorPackManifest({
      ...baseManifest,
      capabilities: [],
    }),
  );
  assert.throws(() =>
    parseOperatorPackManifest({
      ...baseManifest,
      acceptanceScenarios: [
        {
          ...baseManifest.acceptanceScenarios[0],
          fixture: {
            ...baseManifest.acceptanceScenarios[0].fixture,
            docTitle: "Synthetic context",
            docBody: "Synthetic context that requires the Docs capability.",
          },
        },
      ],
    }),
  );
  assert.throws(() =>
    parseOperatorPackManifest({
      ...baseManifest,
      capabilities: [
        baseManifest.capabilities[0],
        baseManifest.capabilities[0],
      ],
    }),
  );
  assert.throws(() =>
    parseOperatorPackManifest({
      ...baseManifest,
      agents: [
        {
          ...baseManifest.agents[0],
          quickActions: [
            baseManifest.agents[0].quickActions[0],
            {
              ...baseManifest.agents[0].quickActions[0],
              key: "other-key",
            },
          ],
        },
      ],
    }),
  );
  assert.throws(() =>
    parseOperatorPackManifest({
      ...baseManifest,
      acceptanceScenarios: [
        {
          ...baseManifest.acceptanceScenarios[0],
          fixture: {
            ...baseManifest.acceptanceScenarios[0].fixture,
            docTitle: "Incomplete synthetic Doc",
          },
        },
      ],
    }),
  );
});

test("resource reconciliation distinguishes managed updates from user conflicts", () => {
  const original = { instructions: "original", nested: { a: 1, b: 2 } };
  assert.equal(
    samePackSnapshot(original, {
      nested: { b: 2, a: 1 },
      instructions: "original",
    }),
    true,
  );
  assert.equal(comparePackVersions("1.2.0", "1.1.9") > 0, true);
  assert.deepEqual(
    decidePackResourceChange({ current: undefined, proposed: original }),
    { action: "create", userModified: false },
  );
  assert.deepEqual(
    decidePackResourceChange({
      current: original,
      proposed: { ...original, instructions: "pack update" },
      resource: {
        managed: true,
        createdByPack: true,
        reattachable: true,
        state: "applied",
        baseline: original,
      },
    }),
    { action: "update", userModified: false },
  );
  assert.deepEqual(
    decidePackResourceChange({
      current: { ...original, instructions: "user edit" },
      proposed: { ...original, instructions: "pack update" },
      resource: {
        managed: true,
        createdByPack: true,
        reattachable: true,
        state: "applied",
        baseline: original,
      },
    }),
    { action: "conflict", userModified: true },
  );
});

test("acceptance rubric evaluates behavior and bounded durable outcomes", () => {
  const rubric = {
    requiresWorkRead: true,
    requiresDocsRead: true,
    requiresWorkWrite: true,
    expectedIssueStatus: "done",
    maxCreatedWorkItems: 0,
  };
  const passed = evaluateOperatorPackAcceptance({
    rubric,
    tools: [
      {
        name: "work.get_issue",
        success: true,
        arguments: { key: "QA-1" },
        response: null,
      },
      {
        name: "docs.search_docs",
        success: true,
        arguments: { query: "fixture" },
        response: { id: "doc-1" },
      },
      {
        name: "work.add_comment",
        success: true,
        arguments: { key: "QA-1" },
        response: null,
      },
      {
        name: "work.update_issue",
        success: true,
        arguments: { key: "QA-1", status: "done" },
        response: null,
      },
    ],
    issueKey: "QA-1",
    docReferences: ["doc-1"],
    issueStatus: "done",
    commentCount: 1,
  });
  assert.equal(passed.passed, true);

  const unbounded = evaluateOperatorPackAcceptance({
    rubric,
    tools: [
      {
        name: "work.get_issue",
        success: true,
        arguments: { key: "OTHER-1" },
        response: null,
      },
      {
        name: "docs.get_doc",
        success: false,
        arguments: { id: "doc-1" },
        response: null,
      },
      {
        name: "work.add_comment",
        success: true,
        arguments: { key: "OTHER-1" },
        response: null,
      },
      {
        name: "work.create_issue",
        success: true,
        arguments: { title: "Unrelated" },
        response: null,
      },
    ],
    issueKey: "QA-1",
    docReferences: ["doc-1"],
    issueStatus: "done",
    commentCount: 1,
  });
  assert.equal(unbounded.passed, false);
  assert.equal(unbounded.checks.boundedWorkCreation, false);
  assert.equal(unbounded.checks.workRead, false);
  assert.equal(unbounded.checks.docsRead, false);
  assert.equal(unbounded.checks.workWrite, false);
});

test("assignment acceptance retries after joining an in-flight coordination tick", async () => {
  let ticks = 0;
  let run;
  const found = await findAcceptanceAssignmentRun({
    tick: async () => {
      ticks += 1;
      if (ticks === 2) run = { id: "assignment-run" };
    },
    find: () => run,
  });
  assert.deepEqual(found, { id: "assignment-run" });
  assert.equal(ticks, 2);
});

test("official catalog and local lifecycle install, preserve, replace, and disable safely", () => {
  const temporary = mkdtempSync(path.join(tmpdir(), "slab-packs-"));
  const database = path.join(temporary, "workspace.db");
  const environment = {
    ...process.env,
    NODE_ENV: "test",
    SLAB_WORKSPACE_DB: database,
  };
  const migration = spawnSync("npm", ["run", "migrate:latest"], {
    cwd: process.cwd(),
    env: environment,
    encoding: "utf8",
  });
  assert.equal(migration.status, 0, migration.stderr || migration.stdout);

  const harness = `
    import assert from "node:assert/strict";
    import { OFFICIAL_OPERATOR_PACKS } from "./lib/packs/catalog.ts";
    import { DocsClient } from "./lib/mcp/docs-client.ts";
    import { WorkClient } from "./lib/mcp/work-client.ts";
    import { agentRepository } from "./lib/repositories/agent-repository.ts";
    import { automationRepository } from "./lib/repositories/automation-repository.ts";
    import { integrationRepository } from "./lib/repositories/integration-repository.ts";
    import { operatorPackRepository } from "./lib/repositories/operator-pack-repository.ts";
    import { runRepository } from "./lib/repositories/run-repository.ts";
    import { settingsRepository } from "./lib/repositories/settings-repository.ts";
    import {
      capabilityStates,
      disableOperatorPack,
      getOperatorPackSummaries,
      importOperatorPack,
      installOperatorPack,
      operatorPackMetrics,
      previewOperatorPack,
      startOperatorPackAcceptance,
    } from "./lib/packs/service.ts";

    const manifest = ${JSON.stringify(baseManifest)};
    assert.deepEqual(OFFICIAL_OPERATOR_PACKS.map((pack) => pack.id), [
      "founder-ops", "sales-ops", "engineering-ops",
    ]);
    assert.match(OFFICIAL_OPERATOR_PACKS[1].workConventions.join(" "), /current deliverable/i);
    importOperatorPack(manifest);
    await installOperatorPack(manifest.id);
    let installation = operatorPackRepository.getOperatorPackInstallation(manifest.id);
    assert.equal(installation.status, "installed");
    const agent = agentRepository.getAgent("test-operator");
    assert.ok(agent);
    assert.equal(agentRepository.listAgentQuickActions(agent.id).length, 1);
    const resource = operatorPackRepository.getOperatorPackResource(manifest.id, "automation", "weekly");
    assert.ok(resource?.resourceId);
    assert.equal(automationRepository.getAutomation(resource.resourceId).enabled, false);
    const oldAcceptance = operatorPackRepository.createOperatorPackAcceptance({
      packId: manifest.id,
      scenarioId: "synthetic-review",
      packVersion: manifest.version,
      rubric: manifest.acceptanceScenarios[0].rubric,
    });
    operatorPackRepository.updateOperatorPackAcceptance(oldAcceptance.id, {
      status: "passed",
      completedAt: new Date().toISOString(),
    });

    agentRepository.updateAgent(agent.id, { instructions: "User-owned instructions" });
    let preview = await previewOperatorPack(manifest.id);
    const conflict = preview.changes.find((change) => change.resourceType === "agent");
    assert.equal(conflict.action, "conflict");
    await installOperatorPack(manifest.id, "preserve");
    assert.equal(agentRepository.getAgent(agent.id).instructions, "User-owned instructions");
    await installOperatorPack(manifest.id, "replace");
    assert.equal(agentRepository.getAgent(agent.id).instructions, manifest.agents[0].instructions);

    await disableOperatorPack(manifest.id);
    installation = operatorPackRepository.getOperatorPackInstallation(manifest.id);
    assert.equal(installation.status, "disabled");
    assert.ok(agentRepository.getAgent(agent.id));
    assert.ok(automationRepository.getAutomation(resource.resourceId));
    assert.ok(operatorPackRepository.listOperatorPackResources(manifest.id).every((item) => !item.managed && item.state === "detached"));

    await installOperatorPack(manifest.id);
    assert.ok(operatorPackRepository.listOperatorPackResources(manifest.id).every((item) => item.managed && item.state === "applied"));

    const actionId = agentRepository.listAgentQuickActions(agent.id)[0].id;
    const renamed = {
      ...manifest,
      version: "1.1.0",
      agents: [{
        ...manifest.agents[0],
        slug: "renamed-test-operator",
        quickActions: [{
          ...manifest.agents[0].quickActions[0],
          label: "Inspect renamed fixture",
        }],
      }],
      automations: [{ ...manifest.automations[0], enabled: true }],
    };
    importOperatorPack(renamed);
    await installOperatorPack(renamed.id);
    const renamedSummary = (await getOperatorPackSummaries()).find((item) => item.manifest.id === renamed.id);
    assert.equal(renamedSummary.acceptance, null);
    assert.equal(operatorPackMetrics().total, 0);
    assert.equal(agentRepository.getAgent(agent.id).slug, "renamed-test-operator");
    assert.equal(agentRepository.listAgents().filter((item) => item.id === agent.id).length, 1);
    assert.equal(agentRepository.listAgentQuickActions(agent.id).length, 1);
    assert.equal(agentRepository.getAgentQuickAction(actionId).label, "Inspect renamed fixture");
    assert.equal(automationRepository.getAutomation(resource.resourceId).enabled, true);

    const currentAcceptance = operatorPackRepository.createOperatorPackAcceptance({
      packId: renamed.id,
      scenarioId: "synthetic-review",
      packVersion: renamed.version,
      rubric: renamed.acceptanceScenarios[0].rubric,
    });
    operatorPackRepository.updateOperatorPackAcceptance(currentAcceptance.id, {
      status: "passed",
      completedAt: new Date().toISOString(),
    });
    assert.equal(operatorPackMetrics().total, 1);
    assert.equal(operatorPackMetrics().passed, 1);

    await disableOperatorPack(renamed.id);
    assert.equal(automationRepository.getAutomation(resource.resourceId).enabled, false);
    await installOperatorPack(renamed.id);
    assert.equal(automationRepository.getAutomation(resource.resourceId).enabled, true);
    assert.ok(operatorPackRepository.listOperatorPackResources(renamed.id).every((item) => item.managed));

    const reduced = {
      ...renamed,
      version: "1.2.0",
      agents: [{ ...renamed.agents[0], quickActions: [] }],
      automations: [],
    };
    importOperatorPack(reduced);
    preview = await previewOperatorPack(reduced.id);
    assert.equal(preview.changes.filter((change) => change.action === "detach").length, 2);
    await installOperatorPack(reduced.id);
    assert.equal(automationRepository.getAutomation(resource.resourceId).enabled, false);
    assert.equal(operatorPackRepository.getOperatorPackResource(reduced.id, "automation", "weekly").state, "detached");
    assert.ok(agentRepository.getAgentQuickAction(actionId));

    const existingAgent = agentRepository.createAgent({
      name: "Existing operator",
      slug: "existing-operator",
      role: "Existing role",
      instructions: "These user-owned instructions are long enough for a manifest collision.",
      model: "default",
      enabled: true,
      fullAccess: false,
    });
    const adopted = {
      ...manifest,
      id: "adopted-pack",
      agents: [{ ...manifest.agents[0], slug: "existing-operator" }],
      automations: [],
    };
    importOperatorPack(adopted);
    await installOperatorPack(adopted.id);
    assert.equal(operatorPackRepository.getOperatorPackResource(adopted.id, "agent", "operator").managed, false);
    assert.equal(operatorPackRepository.getOperatorPackResource(adopted.id, "quick_action", "operator.inspect").managed, true);
    assert.equal(operatorPackRepository.getOperatorPackResource(adopted.id, "quick_action", "operator.inspect").createdByPack, true);
    assert.ok(agentRepository.getAgent(existingAgent.id));
    await installOperatorPack(adopted.id, "replace");
    assert.equal(operatorPackRepository.getOperatorPackResource(adopted.id, "agent", "operator").managed, true);
    assert.equal(operatorPackRepository.getOperatorPackResource(adopted.id, "agent", "operator").createdByPack, false);
    await disableOperatorPack(adopted.id);
    await installOperatorPack(adopted.id);
    assert.equal(operatorPackRepository.getOperatorPackResource(adopted.id, "agent", "operator").managed, true);
    assert.equal(agentRepository.getAgent(existingAgent.id).id, existingAgent.id);

    const scoped = {
      ...manifest,
      id: "scoped-pack",
      agents: [{ ...manifest.agents[0], slug: "scoped-operator" }],
      automations: [],
      capabilities: [{
        category: "work",
        required: true,
        description: "Synthetic Work fixtures.",
      }, {
        category: "product_analytics",
        required: true,
        description: "Product analytics must be granted to this Agent.",
      }],
    };
    importOperatorPack(scoped);
    await installOperatorPack(scoped.id);
    const scopedAgent = agentRepository.getAgent("scoped-operator");
    const integration = integrationRepository.saveIntegration({
      provider: "posthog",
      name: "PostHog",
      config: {},
      credentialsCiphertext: "encrypted-test-value",
      status: "connected",
      lastTestedAt: new Date().toISOString(),
      lastError: null,
      permissions: {},
    });
    assert.equal(capabilityStates(scoped).find((item) => item.category === "product_analytics").available, false);
    integrationRepository.saveIntegration({
      id: integration.id,
      provider: "posthog",
      name: "PostHog",
      config: {},
      credentialsCiphertext: "encrypted-test-value",
      status: "connected",
      lastTestedAt: new Date().toISOString(),
      lastError: null,
      permissions: { [scopedAgent.id]: ["query"] },
    });
    assert.equal(capabilityStates(scoped).find((item) => item.category === "product_analytics").available, true);

    settingsRepository.set("docs_mcp_url", "http://docs.test/mcp");
    settingsRepository.set("docs_api_key", "test-key");
    settingsRepository.set("setup_status_docs", JSON.stringify({
      state: "connected",
      detail: "Connected for test.",
      checkedAt: new Date().toISOString(),
      fingerprint: "http://docs.test/mcp|true",
    }));
    const remoteDocs = [];
    let createCalls = 0;
    let failNextUpdate = false;
    let pauseNextUpdate = false;
    let updateEntered;
    let releaseUpdate;
    let pauseNextGet = false;
    let getEntered;
    let releaseGet;
    DocsClient.list = async ({ tag } = {}) => remoteDocs.filter((doc) => doc.tags.includes(tag));
    DocsClient.get = async (id) => {
      if (pauseNextGet) {
        pauseNextGet = false;
        getEntered();
        await new Promise((resolve) => {
          releaseGet = resolve;
        });
      }
      return remoteDocs.find((doc) => doc.id === id) ?? Promise.reject(new Error("missing"));
    };
    DocsClient.create = async (input) => {
      createCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      const doc = { id: "doc-" + createCalls, slug: "doc", title: input.title, body: input.body, parent_id: null, tags: input.tags, author: input.author, revision: 1, archived_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      remoteDocs.push(doc);
      return doc;
    };
    DocsClient.update = async (id, input) => {
      if (failNextUpdate) {
        failNextUpdate = false;
        throw new Error("synthetic update interruption");
      }
      if (pauseNextUpdate) {
        pauseNextUpdate = false;
        updateEntered();
        await new Promise((resolve) => {
          releaseUpdate = resolve;
        });
      }
      const doc = remoteDocs.find((item) => item.id === id);
      Object.assign(doc, input);
      return doc;
    };
    const docPack = {
      ...manifest,
      id: "doc-pack",
      agents: [{ ...manifest.agents[0], slug: "doc-operator" }],
      automations: [],
      capabilities: [
        { category: "work", required: true, description: "Synthetic Work fixtures." },
        { category: "docs", required: true, description: "Docs fixtures." },
      ],
      docs: [{ key: "guide", title: "Pack guide", body: "A sufficiently long starter document body.", tags: ["pack"] }],
    };
    importOperatorPack(docPack);
    await Promise.all([
      installOperatorPack(docPack.id),
      installOperatorPack(docPack.id),
    ]);
    assert.equal(createCalls, 1);
    assert.equal(remoteDocs.length, 1);
    const docPackV2 = {
      ...docPack,
      version: "1.1.0",
      docs: [{
        ...docPack.docs[0],
        body: "The updated starter document body remains sufficiently long.",
      }],
    };
    importOperatorPack(docPackV2);
    preview = await previewOperatorPack(docPack.id);
    const docUpdate = preview.changes.find((change) => change.resourceType === "doc");
    assert.equal(docUpdate.action, "update");
    assert.equal(docUpdate.proposed.body, docPackV2.docs[0].body);
    failNextUpdate = true;
    await assert.rejects(installOperatorPack(docPack.id), /synthetic update interruption/);
    assert.equal(operatorPackRepository.getOperatorPackResource(docPack.id, "doc", "guide").state, "failed");
    preview = await previewOperatorPack(docPack.id);
    assert.equal(preview.changes.find((change) => change.resourceType === "doc").action, "update");
    await installOperatorPack(docPack.id);
    assert.equal(remoteDocs[0].body, docPackV2.docs[0].body);

    remoteDocs[0].body = "A user-owned edit to the starter document that must be preserved.";
    const docPackV3 = {
      ...docPackV2,
      version: "1.2.0",
      docs: [{
        ...docPackV2.docs[0],
        body: "A third pack-authored starter document body for conflict QA.",
      }],
    };
    importOperatorPack(docPackV3);
    preview = await previewOperatorPack(docPack.id);
    const docConflict = preview.changes.find((change) => change.resourceType === "doc");
    assert.equal(docConflict.action, "conflict");
    assert.equal(docConflict.baseline.body, docPackV2.docs[0].body);
    await installOperatorPack(docPack.id, "preserve");
    assert.equal(remoteDocs[0].body, "A user-owned edit to the starter document that must be preserved.");
    await installOperatorPack(docPack.id, "replace");
    assert.equal(remoteDocs[0].body, docPackV3.docs[0].body);

    const docPackV4 = {
      ...docPackV3,
      version: "1.3.0",
      docs: [{
        ...docPackV3.docs[0],
        body: "A fourth pack-authored body used to serialize disable and install.",
      }],
    };
    importOperatorPack(docPackV4);
    const updateStarted = new Promise((resolve) => {
      updateEntered = resolve;
    });
    pauseNextUpdate = true;
    const installing = installOperatorPack(docPack.id);
    await updateStarted;
    const disabling = disableOperatorPack(docPack.id);
    releaseUpdate();
    await Promise.all([installing, disabling]);
    assert.equal(operatorPackRepository.getOperatorPackInstallation(docPack.id).status, "disabled");
    assert.ok(operatorPackRepository.listOperatorPackResources(docPack.id).every((item) => item.state === "detached"));

    const racePack = {
      ...docPack,
      id: "race-pack",
      agents: [{ ...docPack.agents[0], slug: "race-operator" }],
    };
    importOperatorPack(racePack);
    await installOperatorPack(racePack.id);
    const raceAgent = agentRepository.getAgent("race-operator");
    const racePackV2 = {
      ...racePack,
      version: "1.1.0",
      agents: [{
        ...racePack.agents[0],
        instructions: "Updated pack instructions that must not overwrite a concurrent edit.",
      }],
    };
    importOperatorPack(racePackV2);
    const getStarted = new Promise((resolve) => {
      getEntered = resolve;
    });
    pauseNextGet = true;
    const racingInstall = installOperatorPack(racePack.id);
    await getStarted;
    agentRepository.updateAgent(raceAgent.id, {
      instructions: "A concurrent user edit made after the install preview.",
    });
    releaseGet();
    await assert.rejects(racingInstall, /changed after preview/);
    assert.equal(
      agentRepository.getAgent(raceAgent.id).instructions,
      "A concurrent user edit made after the install preview.",
    );

    settingsRepository.set("work_mcp_url", "http://work.test/mcp");
    settingsRepository.set("work_api_key", "test-key");
    settingsRepository.set("setup_status_work", JSON.stringify({
      state: "connected",
      detail: "Connected for test.",
      checkedAt: new Date().toISOString(),
      fingerprint: "http://work.test/mcp|true",
    }));
    const workProjects = [];
    let createProjectCalls = 0;
    WorkClient.listProjects = async () => workProjects;
    WorkClient.createProject = async (input) => {
      createProjectCalls += 1;
      const project = { ...input, id: "qa-project", created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      workProjects.push(project);
      return project;
    };
    WorkClient.createIssue = async (input) => ({
      id: "qa-acceptance-1",
      key: "QA-1",
      project_key: input.project_key,
      title: input.title,
      description: input.description,
      status: "new",
      type: "task",
      priority: input.priority,
      assignee: null,
      labels: input.labels,
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const acceptancePack = {
      ...manifest,
      id: "acceptance-identity-pack",
      agents: [{ ...manifest.agents[0], slug: "acceptance-operator" }],
      automations: [],
      acceptanceScenarios: [{
        ...manifest.acceptanceScenarios[0],
        execution: "review",
      }],
    };
    importOperatorPack(acceptancePack);
    await installOperatorPack(acceptancePack.id);
    const acceptanceAgent = agentRepository.getAgent("acceptance-operator");
    agentRepository.updateAgent(acceptanceAgent.id, { slug: "operator-renamed-by-user" });
    await installOperatorPack(acceptancePack.id, "preserve");
    const acceptanceRun = await startOperatorPackAcceptance(acceptancePack.id);
    assert.equal(runRepository.getRun(acceptanceRun.runId).agentId, acceptanceAgent.id);
    assert.equal(createProjectCalls, 1);
    assert.equal(workProjects[0].key, "QA");
    assert.equal(workProjects[0].name, "Operator Pack Acceptance");
  `;
  const run = spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--experimental-strip-types",
      "--experimental-loader",
      "./scripts/test-alias-loader.mjs",
      "--input-type=module",
      "--eval",
      harness,
    ],
    { cwd: process.cwd(), env: environment, encoding: "utf8" },
  );
  try {
    assert.equal(run.status, 0, run.stderr || run.stdout);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
