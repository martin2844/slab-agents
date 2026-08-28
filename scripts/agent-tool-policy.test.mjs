import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";
import knexFactory from "knex";

register("./test-alias-loader.mjs", import.meta.url);
const migrationDirectory = path.resolve("db/migrations");

test("agent tool policies are versioned, restrictive, and immutable per run", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "slab-tool-policy-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "workspace.db");
  const migrations = knexFactory({
    client: "better-sqlite3",
    connection: { filename },
    useNullAsDefault: true,
    migrations: { directory: migrationDirectory, loadExtensions: [".cjs"] },
  });
  await migrations.migrate.latest();
  await migrations.destroy();
  process.env.SLAB_WORKSPACE_DB = filename;
  process.env.SLAB_INTERNAL_URL = "http://127.0.0.1:3009";

  const [
    { agentRepository },
    { runRepository },
    { conversationRepository },
    { agentToolPolicyRepository },
    { snapshotAgentToolPolicies, filterToolsByRunPolicy, policyExposesAnyTool },
    { settingsRepository },
    { startRunnerRun },
    { buildAgentToolCatalog },
    { storeEmailConnectorToken },
    { db },
    toolPolicyRoute,
  ] = await Promise.all([
    import("../lib/repositories/agent-repository.ts"),
    import("../lib/repositories/run-repository.ts"),
    import("../lib/repositories/conversation-repository.ts"),
    import("../lib/repositories/agent-tool-policy-repository.ts"),
    import("../lib/agent-tool-policy.ts"),
    import("../lib/repositories/settings-repository.ts"),
    import("../lib/runner.ts"),
    import("../lib/agent-tool-catalog.ts"),
    import("../lib/integrations/email-token-vault.ts"),
    import("../lib/db/database.ts"),
    import("../app/api/agents/[id]/tool-policies/route.ts"),
  ]);

  const guarded = agentRepository.createAgent({
    name: "COO",
    slug: "coo-policy",
    role: "Operations",
    instructions: "Coordinate the operating plan.",
    runtime: "codex",
    model: "default",
    enabled: true,
    fullAccess: false,
  });
  assert.equal(
    policyExposesAnyTool({ defaultMode: "deny", tools: {} }, [
      "calendar_list_events",
    ]),
    false,
  );
  assert.equal(
    policyExposesAnyTool(
      {
        defaultMode: "deny",
        tools: { calendar_list_events: "approve" },
      },
      ["calendar_list_events"],
    ),
    true,
  );
  assert.equal(
    policyExposesAnyTool(
      {
        defaultMode: "deny",
        tools: { calendar_create_event: "approve" },
      },
      ["calendar_list_events"],
    ),
    false,
  );
  const full = agentRepository.createAgent({
    name: "Founder",
    slug: "founder-policy",
    role: "Founder",
    instructions: "Lead the company operating plan.",
    runtime: "codex",
    model: "default",
    enabled: true,
    fullAccess: true,
  });

  const emailAccess = {
    agentId: guarded.id,
    profileId: "profile-test",
    profileName: "Test email",
    accountIds: ["account-test"],
    readEnabled: true,
    draftEnabled: true,
    sendEnabled: true,
    sendPolicy: "approval_required",
    tokenId: "token-test",
    tokenPrefix: "slab_test",
    tokenCreatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const guardedCatalog = buildAgentToolCatalog({
    agent: guarded,
    integrations: [],
    emailAccess,
  });
  const catalogTool = (serverName, toolName) =>
    guardedCatalog
      .find(({ serverName: name }) => name === serverName)
      ?.tools.find(({ name }) => name === toolName);
  assert.equal(catalogTool("work", "get_issue")?.legacyMode, "approve");
  assert.equal(catalogTool("work", "assign_issue")?.legacyMode, "prompt");
  assert.equal(catalogTool("email", "email_search")?.legacyMode, "approve");
  assert.deepEqual(
    {
      mode: catalogTool("email", "email_send")?.legacyMode,
      maximum: catalogTool("email", "email_send")?.maximumMode,
    },
    { mode: "prompt", maximum: "prompt" },
  );
  const sendOnlyEmail = buildAgentToolCatalog({
    agent: guarded,
    integrations: [],
    emailAccess: { ...emailAccess, readEnabled: false },
  }).find(({ serverName }) => serverName === "email");
  assert.ok(sendOnlyEmail?.tools.some(({ name }) => name === "email_send"));
  assert.ok(!sendOnlyEmail?.tools.some(({ name }) => name === "email_reply"));
  const calendarCatalog = buildAgentToolCatalog({
    agent: guarded,
    emailAccess: null,
    integrations: [
      {
        id: "calendar-test",
        provider: "calendar_google",
        name: "Operations calendar",
        slug: "operations-calendar",
        status: "connected",
        writePolicy: "disabled",
        tools: [
          {
            key: "calendar_list_events",
            name: "List events",
            description: "Read events.",
            readOnly: true,
          },
          {
            key: "calendar_create_event",
            name: "Create event",
            description: "Create an event.",
            readOnly: false,
          },
        ],
      },
    ],
  });
  assert.deepEqual(
    calendarCatalog
      .find(({ serverName }) => serverName === "calendar_operations-calendar")
      ?.tools.map(({ name }) => name),
    ["calendar_list_events"],
  );

  const work = agentToolPolicyRepository.save({
    agentId: guarded.id,
    serverName: "work",
    defaultMode: "deny",
    tools: {
      get_issue: "approve",
      assign_issue: "approve",
      set_issue_status: "prompt",
    },
    expectedVersion: 0,
  });
  assert.equal(work.version, 1);
  await assert.rejects(
    Promise.resolve().then(() =>
      agentToolPolicyRepository.save({
        agentId: guarded.id,
        serverName: "work",
        defaultMode: "deny",
        tools: { get_issue: "approve" },
        expectedVersion: 0,
      }),
    ),
    /changed/i,
  );
  const email = agentToolPolicyRepository.save({
    agentId: guarded.id,
    serverName: "email",
    defaultMode: "deny",
    tools: { email_search: "approve", email_send: "approve" },
    expectedVersion: 0,
  });

  const createRun = (agentId) =>
    runRepository.createRun({
      agentId,
      trigger: "manual",
      mode: "task",
      runInstructions: "Execute the test plan.",
    });
  const runA = createRun(guarded.id);
  const liveServers = [
    { name: "work", url: "https://work.example.test/mcp" },
    {
      name: "email",
      url: "https://email.example.test/mcp",
      approval: {
        defaultMode: "approve",
        tools: { email_send: "prompt" },
      },
    },
  ];
  const first = snapshotAgentToolPolicies({
    runId: runA.id,
    agent: guarded,
    servers: liveServers,
  });
  assert.deepEqual(first.servers[0].approval, {
    defaultMode: "deny",
    tools: {
      get_issue: "approve",
      assign_issue: "approve",
      set_issue_status: "prompt",
    },
  });
  assert.deepEqual(first.servers[1].approval, {
    defaultMode: "deny",
    tools: { email_search: "approve", email_send: "prompt" },
  });
  assert.deepEqual(
    filterToolsByRunPolicy(runA.id, "work", [
      "get_issue",
      "assign_issue",
      "delete_issue",
    ]),
    ["get_issue", "assign_issue"],
  );
  assert.deepEqual(
    filterToolsByRunPolicy(runA.id, "added_after_start", ["read_secret"]),
    [],
  );

  const updated = agentToolPolicyRepository.save({
    agentId: guarded.id,
    serverName: "work",
    defaultMode: "deny",
    tools: { get_issue: "approve", assign_issue: "deny" },
    expectedVersion: work.version,
  });
  assert.equal(updated.version, 2);
  assert.equal(email.version, 1);
  assert.deepEqual(
    snapshotAgentToolPolicies({
      runId: runA.id,
      agent: guarded,
      servers: [
        ...liveServers,
        { name: "new_after_start", url: "https://new.example.test/mcp" },
      ],
    }).servers[0].approval,
    first.servers[0].approval,
  );
  assert.equal(
    snapshotAgentToolPolicies({
      runId: runA.id,
      agent: guarded,
      servers: [
        ...liveServers,
        { name: "new_after_start", url: "https://new.example.test/mcp" },
      ],
    }).servers.some(({ name }) => name === "new_after_start"),
    false,
  );

  const runB = createRun(guarded.id);
  assert.deepEqual(
    snapshotAgentToolPolicies({
      runId: runB.id,
      agent: guarded,
      servers: liveServers,
    }).servers[0].approval,
    {
      defaultMode: "deny",
      tools: { get_issue: "approve", assign_issue: "deny" },
    },
  );

  const legacyGuardedRun = createRun(guarded.id);
  const legacyDocs = snapshotAgentToolPolicies({
    runId: legacyGuardedRun.id,
    agent: guarded,
    servers: [{ name: "docs", url: "https://docs.example.test/mcp" }],
  }).servers[0].approval;
  assert.equal(legacyDocs.defaultMode, "prompt");
  assert.equal(legacyDocs.tools.get_doc, "approve");

  const legacyFullRun = createRun(full.id);
  assert.deepEqual(
    snapshotAgentToolPolicies({
      runId: legacyFullRun.id,
      agent: full,
      servers: [{ name: "work", url: "https://work.example.test/mcp" }],
    }).servers[0].approval,
    { defaultMode: "approve", tools: {} },
  );

  const legacyPosthogRun = createRun(guarded.id);
  assert.deepEqual(
    snapshotAgentToolPolicies({
      runId: legacyPosthogRun.id,
      agent: guarded,
      servers: [
        { name: "work_posthog", url: "https://posthog.example.test/mcp" },
      ],
    }).servers[0].approval,
    { defaultMode: "prompt", tools: {} },
  );

  assert.throws(
    () =>
      snapshotAgentToolPolicies({
        runId: runA.id,
        agent: full,
        servers: [{ name: "work", url: "https://work.example.test/mcp" }],
      }),
    /does not belong/i,
  );

  const routeContext = { params: Promise.resolve({ id: guarded.slug }) };
  const listResponse = await toolPolicyRoute.GET(
    new Request("http://agents.test/api/agents/coo-policy/tool-policies"),
    routeContext,
  );
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).data.length, 2);

  const saveRequest = () =>
    new Request("http://agents.test/api/agents/coo-policy/tool-policies", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverName: "docs",
        defaultMode: "deny",
        tools: { get_doc: "approve" },
        expectedVersion: 0,
      }),
    });
  const savedResponse = await toolPolicyRoute.PUT(saveRequest(), routeContext);
  assert.equal(savedResponse.status, 200);
  assert.equal((await savedResponse.json()).data.version, 1);
  const staleResponse = await toolPolicyRoute.PUT(saveRequest(), routeContext);
  assert.equal(staleResponse.status, 409);
  assert.equal((await staleResponse.json()).error.code, "VERSION_CONFLICT");

  settingsRepository.set("runner_url", "http://runner.test");
  settingsRepository.set("work_mcp_url", "http://127.0.0.1:9/mcp");
  settingsRepository.set("docs_mcp_url", "http://127.0.0.1:9/mcp");
  const timestamp = new Date().toISOString();
  db.prepare(
    `INSERT INTO email_integrations
     (id,service_url,status,last_tested_at,last_error,created_at,updated_at)
     VALUES ('email',?,'connected',?,NULL,?,?)`,
  ).run("http://email.test", timestamp, timestamp, timestamp);
  db.prepare(
    `INSERT INTO agent_email_access
     (agent_id,profile_id,profile_name,read_enabled,draft_enabled,send_enabled,send_policy,token_id,token_prefix,token_created_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    guarded.id,
    "profile-test",
    "Test email",
    1,
    1,
    1,
    "approval_required",
    "token-test",
    "slab_test",
    timestamp,
    timestamp,
    timestamp,
  );
  db.prepare(
    "INSERT INTO agent_email_accounts (agent_id,account_id) VALUES (?,?)",
  ).run(guarded.id, "account-test");
  storeEmailConnectorToken("token-test", "scoped-email-secret");
  const thread = conversationRepository.createThread(
    guarded.id,
    "Policy transport",
  );
  const runnerRun = runRepository.createRun({
    agentId: guarded.id,
    threadId: thread.id,
    trigger: "manual",
    mode: "task",
    runInstructions: "Exercise the Runner policy boundary.",
  });
  let runnerBody;
  const runner = await startRunnerRun(
    {
      runId: runnerRun.id,
      controlPlaneRunId: runnerRun.id,
      agent: guarded,
      thread,
      messages: [],
      prompt: "Inspect the current issue.",
      execution: {
        trigger: "manual",
        mode: "task",
        issueKey: null,
        policy: "Use the assigned tools only.",
      },
      emailReplyToolConstraint: {
        accountId: "account-test",
        messageId: "message-test",
      },
    },
    {
      fetcher: async (url, init = {}) => {
        if (String(url).endsWith("/attach")) {
          return Response.json(
            { error: { message: "not found" } },
            { status: 404 },
          );
        }
        if (String(url).endsWith("/runs")) {
          runnerBody = JSON.parse(String(init.body));
          return Response.json({ runId: runnerRun.id, status: "running" });
        }
        throw new Error(`Unexpected Runner request: ${url}`);
      },
    },
  );
  await runner.contextProfile;
  assert.deepEqual(
    runnerBody.mcpServers.find(({ name }) => name === "work").approval,
    {
      defaultMode: "deny",
      tools: { get_issue: "approve", assign_issue: "deny" },
    },
  );
  assert.deepEqual(
    runnerBody.mcpServers.find(({ name }) => name === "email").credentials,
    {
      bearerToken: "scoped-email-secret",
      headers: {
        "X-Slab-Reply-Account-Sha256":
          "d86f70b3c693a77a2bed6e40c741e09cd5b82d09a97a3346b7a718d609c89224",
        "X-Slab-Reply-Message-Sha256":
          "dbe78f550dedd48491a3e1a377c81750a6f353dbf16441ae34e660c74d4c672a",
      },
    },
  );
  assert.equal(runner.capabilitySnapshot.toolPolicies.snapshotId, runnerRun.id);

  let retryBody;
  const retry = await startRunnerRun(
    {
      runId: runA.id,
      controlPlaneRunId: runA.id,
      agent: guarded,
      thread,
      messages: [],
      prompt: "Retry the frozen assignment policy.",
      execution: {
        trigger: "manual",
        mode: "task",
        issueKey: null,
        policy: "Use the frozen tools only.",
      },
    },
    {
      fetcher: async (url, init = {}) => {
        if (String(url).endsWith("/attach")) {
          return Response.json(
            { error: { message: "not found" } },
            { status: 404 },
          );
        }
        if (String(url).endsWith("/runs")) {
          retryBody = JSON.parse(String(init.body));
          return Response.json({ runId: runA.id, status: "running" });
        }
        throw new Error(`Unexpected Runner request: ${url}`);
      },
    },
  );
  await retry.contextProfile;
  assert.match(
    retryBody.agent.instructions,
    /Work tools available in this run:.*assign_issue/,
  );
  assert.doesNotMatch(
    retryBody.agent.instructions,
    /This run cannot assign Work items/,
  );

  agentToolPolicyRepository.save({
    agentId: guarded.id,
    serverName: "corrupt_test",
    defaultMode: "approve",
    tools: { delete_everything: "deny" },
    expectedVersion: 0,
  });
  db.prepare(
    "UPDATE agent_tool_policies SET tools_json=? WHERE agent_id=? AND server_name=?",
  ).run("{not-json", guarded.id, "corrupt_test");
  assert.throws(
    () => agentToolPolicyRepository.get(guarded.id, "corrupt_test"),
    /corrupt/i,
  );

  db.prepare(
    "UPDATE run_tool_policy_snapshots SET policies_json=? WHERE run_id=?",
  ).run("{not-json", runA.id);
  assert.throws(
    () => filterToolsByRunPolicy(runA.id, "work", ["get_issue"]),
    /corrupt/i,
  );
});
