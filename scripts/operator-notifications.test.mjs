import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";
import knexFactory from "knex";

register("./test-alias-loader.mjs", import.meta.url);

test("operator attention is delivered once through a scoped Email profile", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "slab-notifications-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "workspace.db");
  const migrations = knexFactory({
    client: "better-sqlite3",
    connection: { filename },
    useNullAsDefault: true,
    migrations: {
      directory: path.resolve("db/migrations"),
      loadExtensions: [".cjs"],
    },
  });
  await migrations.migrate.latest();
  await migrations.destroy();

  const sent = [];
  const revokedTokens = [];
  let tokenCount = 0;
  let sendPause = null;
  let failNextRevocation = false;
  const server = createServer(async (request, response) => {
    const body = [];
    for await (const chunk of request) body.push(chunk);
    const input = body.length
      ? JSON.parse(Buffer.concat(body).toString("utf8"))
      : null;
    if (request.url === "/api/accounts" && request.method === "GET") {
      assert.equal(request.headers.authorization, "Bearer admin-secret");
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify([{
        id: "account-1",
        provider: "imap_smtp",
        emailAddress: "slab@example.com",
        displayName: "Slab",
        enabled: true,
        capabilities: {
          read: true,
          search: true,
          draft: true,
          send: true,
          reply: true,
          threads: true,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]));
      return;
    }
    if (request.url === "/api/access-profiles" && request.method === "POST") {
      assert.deepEqual(input, {
        name: "slab-agents:operator-notifications",
        readEnabled: false,
        draftEnabled: false,
        sendEnabled: true,
        accountIds: ["account-1"],
      });
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
        id: "profile-1",
        ...input,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
      return;
    }
    if (
      request.url === "/api/access-profiles/profile-1" &&
      request.method === "PATCH"
    ) {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
        id: "profile-1",
        ...input,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
      return;
    }
    if (
      request.url === "/api/access-profiles/profile-1/tokens" &&
      request.method === "POST"
    ) {
      tokenCount += 1;
      const tokenId = tokenCount === 1 ? "notification-token" : `notification-token-${tokenCount}`;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
        id: tokenId,
        prefix: "slab_notify",
        token: `connector-secret-${tokenCount}`,
      }));
      return;
    }
    if (
      request.url?.startsWith("/api/access-profiles/profile-1/tokens/") &&
      request.method === "DELETE"
    ) {
      if (failNextRevocation) {
        failNextRevocation = false;
        response.statusCode = 503;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({
          error: { code: "TEMPORARY_FAILURE", message: "revocation unavailable" },
        }));
        return;
      }
      revokedTokens.push(request.url.split("/").at(-1));
      response.statusCode = 204;
      response.end();
      return;
    }
    if (request.url === "/api/mail/send" && request.method === "POST") {
      assert.equal(request.headers.authorization, "Bearer connector-secret-1");
      if (sendPause) {
        sendPause.started();
        await sendPause.wait;
      }
      sent.push(input);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ status: "sent", messageId: `message-${sent.length}` }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert(address && typeof address !== "string");

  process.env.SLAB_WORKSPACE_DB = filename;
  process.env.SLAB_EMAIL_ADMIN_KEY = "admin-secret";
  process.env.SLAB_PUBLIC_URL = "https://agents.example.com";
  const [{ db }, service, { operatorNotificationRepository }] = await Promise.all([
    import("../lib/db/database.ts"),
    import("../lib/operator-notification-service.ts"),
    import("../lib/repositories/operator-notification-repository.ts"),
  ]);
  t.after(() => db.close());

  const timestamp = new Date().toISOString();
  db.prepare(
    `INSERT INTO email_integrations
     (id,service_url,status,last_tested_at,last_error,created_at,updated_at)
     VALUES ('email',?,'connected',?,NULL,?,?)`,
  ).run(`http://127.0.0.1:${address.port}`, timestamp, timestamp, timestamp);

  const state = await service.saveOperatorNotificationSettings({
    enabled: true,
    recipientEmail: "operator@example.com",
    accountId: "account-1",
  });
  assert.equal(state.enabled, true);
  assert.equal(state.tokenPrefix, "slab_notify");
  const persisted = db
    .prepare("SELECT * FROM operator_notification_settings WHERE id=1")
    .get();
  assert.equal(persisted.token_id, "notification-token");
  assert.equal(persisted.token_service_url, `http://127.0.0.1:${address.port}`);
  assert.equal(JSON.stringify(persisted).includes("connector-secret"), false);
  const encryptedToken = await readFile(
    path.join(directory, "email-connector-tokens", "notification-token.enc"),
    "utf8",
  );
  assert.equal(encryptedToken.includes("connector-secret-1"), false);

  const eventTimestamp = new Date(Date.now() + 1_000).toISOString();
  db.prepare(
    `INSERT INTO agents
     (id,name,slug,role,instructions,runtime,model,enabled,created_at,updated_at)
     VALUES ('agent-1','COO','coo','Operator','Operate','codex','default',1,?,?)`,
  ).run(eventTimestamp, eventTimestamp);
  db.prepare(
    `INSERT INTO runs
     (id,agent_id,status,runtime,model,trigger,mode,run_instructions,error,
      created_at,queued_at,started_at,completed_at)
     VALUES ('run-approval','agent-1','waiting_approval','codex','default','chat','chat','',NULL,?,?,?,?)`,
  ).run(eventTimestamp, eventTimestamp, eventTimestamp, eventTimestamp);
  db.prepare(
    `INSERT INTO approvals
     (id,run_id,runner_approval_id,command,details_json,status,created_at)
     VALUES ('approval-1','run-approval','runner-approval','Send email as slab@example.com','{}','pending',?)`,
  ).run(eventTimestamp);
  db.prepare(
    `INSERT INTO runs
     (id,agent_id,status,runtime,model,trigger,mode,run_instructions,error,
      created_at,queued_at,started_at,completed_at)
     VALUES ('run-failed','agent-1','failed','codex','default','automation','review','',
             'Runtime unavailable',?,?,?,?)`,
  ).run(eventTimestamp, eventTimestamp, eventTimestamp, eventTimestamp);
  db.prepare(
    `INSERT INTO work_coordination_items
     (issue_key,project_key,assignee,semantic_status,labels_json,first_seen_at,last_seen_at)
     VALUES ('OPS-1','OPS','coo','blocked','["status:blocked"]',?,?)`,
  ).run(eventTimestamp, eventTimestamp);
  db.prepare(
    `INSERT INTO integrations
     (id,provider,name,config_json,credentials_ciphertext,status,last_error,
      created_at,updated_at,slug,enabled,version)
     VALUES ('integration-1','posthog','PostHog','{}','encrypted','failed','timeout',
             ?,?,'posthog',1,1)`,
  ).run(eventTimestamp, eventTimestamp);
  db.prepare(
    `INSERT INTO system_update_requests
     (id,action,channel,source,state,requested_at,expires_at,completed_at,
      error_code,error_message,created_at,updated_at)
     VALUES ('update-1','apply','stable','manual','failed',?,?,?,'HEALTH_FAILED',
             'Health check failed',?,?)`,
  ).run(eventTimestamp, eventTimestamp, eventTimestamp, eventTimestamp, eventTimestamp);

  await service.tickOperatorNotifications();
  assert.equal(sent.length, 5);
  assert.deepEqual(
    sent.map(({ subject }) => subject).sort(),
    [
      "Approval required · COO",
      "Run failed · COO",
      "Integration unavailable · PostHog",
      "Slab apply failed",
      "Work blocked · OPS-1",
    ].sort(),
  );
  assert.ok(sent.every(({ to }) => to[0] === "operator@example.com"));
  assert.ok(sent.every(({ expectedFrom }) => expectedFrom === "slab@example.com"));
  assert.ok(sent.some(({ text }) => text.includes("https://agents.example.com/runs/run-approval")));
  assert.equal(operatorNotificationRepository.listRecent().length, 5);
  const publicDelivery = service.getOperatorNotificationState().recentDeliveries[0];
  assert.equal("body" in publicDelivery, false);
  assert.equal("dedupeKey" in publicDelivery, false);

  await service.tickOperatorNotifications();
  assert.equal(sent.length, 5, "attention notifications must be deduplicated");

  const stale = operatorNotificationRepository.enqueue({
    dedupeKey: "approval:already-resolved",
    kind: "approval_waiting",
    resourceType: "approval",
    resourceId: "already-resolved",
    subject: "Stale approval",
    body: "This should not be delivered.",
  });
  assert.ok(stale);
  await service.tickOperatorNotifications();
  assert.equal(sent.length, 5);
  assert.equal(
    operatorNotificationRepository.getDelivery(stale.id)?.status,
    "cancelled",
  );

  const interrupted = operatorNotificationRepository.enqueue({
    dedupeKey: "run-failed:interrupted-delivery",
    kind: "run_failed",
    resourceType: "run",
    resourceId: "run-failed",
    subject: "Interrupted delivery",
    body: "Retry this alert after its worker disappears.",
  });
  assert.ok(interrupted);
  assert.equal(operatorNotificationRepository.claim(interrupted.id)?.status, "sending");
  db.prepare(
    "UPDATE operator_notification_outbox SET claimed_at=? WHERE id=?",
  ).run("2020-01-01T00:00:00.000Z", interrupted.id);
  assert.equal(
    operatorNotificationRepository.recoverStaleClaims(
      "2020-01-01T00:01:00.000Z",
    ),
    1,
  );
  assert.equal(
    operatorNotificationRepository.getDelivery(interrupted.id)?.status,
    "pending",
  );
  await service.tickOperatorNotifications();
  assert.equal(
    operatorNotificationRepository.getDelivery(interrupted.id)?.status,
    "sent",
  );

  const inFlight = operatorNotificationRepository.enqueue({
    dedupeKey: "run-failed:disable-in-flight",
    kind: "run_failed",
    resourceType: "run",
    resourceId: "run-failed",
    subject: "In-flight delivery",
    body: "This delivery is already claimed.",
  });
  assert.ok(inFlight);
  let notifyStarted;
  let releaseSend;
  const started = new Promise((resolve) => {
    notifyStarted = resolve;
  });
  const wait = new Promise((resolve) => {
    releaseSend = resolve;
  });
  sendPause = { started: notifyStarted, wait };
  const deliveryTick = service.tickOperatorNotifications();
  await started;
  const enabledSettings = operatorNotificationRepository.getSettings();
  operatorNotificationRepository.saveSettings({
    ...enabledSettings,
    enabled: false,
  });
  releaseSend();
  await deliveryTick;
  sendPause = null;
  assert.equal(
    operatorNotificationRepository.getDelivery(inFlight.id)?.status,
    "sent",
    "disabling must not misreport an already dispatched email as cancelled",
  );

  const vaultDirectory = path.join(directory, "email-connector-tokens");
  await rm(vaultDirectory, { recursive: true, force: true });
  await writeFile(vaultDirectory, "blocks vault directory creation");
  failNextRevocation = true;
  await assert.rejects(
    service.saveOperatorNotificationSettings({
      enabled: true,
      recipientEmail: "operator@example.com",
      accountId: "account-1",
    }),
  );
  assert.deepEqual(revokedTokens, []);
  assert.deepEqual(
    operatorNotificationRepository.listDueTokenRevocations().map(({ tokenId }) => tokenId),
    ["notification-token-2"],
    "a failed remote revocation must remain durable",
  );
  assert.equal(
    operatorNotificationRepository.getSettings().tokenId,
    "notification-token",
    "failed vault persistence must not replace durable token metadata",
  );
  await rm(vaultDirectory, { force: true });
  db.prepare("UPDATE email_integrations SET service_url=? WHERE id='email'").run(
    "http://127.0.0.1:1",
  );
  await service.tickOperatorNotifications();
  assert.deepEqual(revokedTokens, ["notification-token-2"]);
  assert.deepEqual(operatorNotificationRepository.listDueTokenRevocations(), []);

  const replacementRevocations = [];
  const replacementServer = createServer(async (request, response) => {
    const body = [];
    for await (const chunk of request) body.push(chunk);
    const input = body.length
      ? JSON.parse(Buffer.concat(body).toString("utf8"))
      : null;
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/accounts" && request.method === "GET") {
      response.end(JSON.stringify([{
        id: "account-1",
        provider: "imap_smtp",
        emailAddress: "replacement@example.com",
        displayName: "Replacement",
        enabled: true,
        capabilities: {
          read: true,
          search: true,
          draft: true,
          send: true,
          reply: true,
          threads: true,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]));
      return;
    }
    if (request.url === "/api/access-profiles" && request.method === "POST") {
      response.end(JSON.stringify({
        id: "replacement-profile",
        ...input,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
      return;
    }
    if (
      request.url === "/api/access-profiles/replacement-profile/tokens" &&
      request.method === "POST"
    ) {
      response.end(JSON.stringify({
        id: "replacement-token",
        prefix: "replacement",
        token: "replacement-secret",
      }));
      return;
    }
    if (request.method === "DELETE") {
      replacementRevocations.push(request.url);
      response.statusCode = 204;
      response.end();
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: "not found" } }));
  });
  await new Promise((resolve) => replacementServer.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => replacementServer.close(resolve)));
  const replacementAddress = replacementServer.address();
  assert(replacementAddress && typeof replacementAddress !== "string");
  const replacementUrl = `http://127.0.0.1:${replacementAddress.port}`;
  db.prepare(
    "UPDATE email_integrations SET service_url=?,status='connected' WHERE id='email'",
  ).run(replacementUrl);

  await service.saveOperatorNotificationSettings({
    enabled: true,
    recipientEmail: "operator@example.com",
    accountId: "account-1",
  });

  assert.deepEqual(
    revokedTokens,
    ["notification-token-2", "notification-token"],
    "the previous token must be revoked at the service that issued it",
  );
  assert.deepEqual(
    replacementRevocations,
    [],
    "an idempotent replacement service must never receive the old token revocation",
  );
  assert.equal(operatorNotificationRepository.getSettings().tokenId, "replacement-token");
  assert.equal(operatorNotificationRepository.getSettings().tokenServiceUrl, replacementUrl);
});
