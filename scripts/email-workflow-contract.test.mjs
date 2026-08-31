import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";
import knexFactory from "knex";

register("./test-alias-loader.mjs", import.meta.url);

const migrationDirectory = path.resolve("db/migrations");

async function temporaryDatabase(t, prefix) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "workspace.db");
  const knex = knexFactory({
    client: "better-sqlite3",
    connection: { filename },
    useNullAsDefault: true,
    migrations: { directory: migrationDirectory, loadExtensions: [".cjs"] },
  });
  t.after(() => knex.destroy());
  return { knex, filename };
}

test("email workflow schemas keep reply execution linear and bounded", async () => {
  const {
    automationWorkflowStepsSchema,
    emailAutomationMatchSchema,
    matchesEmailAutomation,
    nextAutomationWorkflowStepId,
  } = await import("../lib/automation-workflow.ts");
  const agentId = "11111111-1111-4111-8111-111111111111";
  const step = (id, action = "analyze") => ({
    id,
    type: action === "review_and_reply" ? "agent_review" : "agent_task",
    agentId,
    action,
    prompt: "Handle this email.",
  });

  assert.equal(
    automationWorkflowStepsSchema.safeParse([
      step("reply", "review_and_reply"),
      step("after"),
    ]).success,
    false,
  );
  assert.equal(
    automationWorkflowStepsSchema.safeParse([
      step("draft", "draft_reply"),
      step("reply", "review_and_reply"),
    ]).success,
    true,
  );
  assert.equal(nextAutomationWorkflowStepId([]), "draft-step-1");
  assert.equal(
    nextAutomationWorkflowStepId([
      { id: "draft-step-1" },
      { id: "legacy-custom-id" },
    ]),
    "draft-step-2",
  );
  assert.equal(
    automationWorkflowStepsSchema.safeParse([
      step("reply-1", "review_and_reply"),
      step("reply-2", "review_and_reply"),
    ]).success,
    false,
  );

  const match = emailAutomationMatchSchema.parse({
    recipientAddress: "Clara@Clasific.ar",
    senderDomain: "EYCON.COM",
    subjectIncludes: "pricing",
  });
  assert.equal(
    matchesEmailAutomation(match, {
      from: { address: "damian@eycon.com" },
      to: [{ address: "clara@clasific.ar" }],
      subject: "Re: Pricing and volume",
    }),
    true,
  );
  assert.equal(
    matchesEmailAutomation(match, {
      from: { address: "damian@example.com" },
      to: [{ address: "clara@clasific.ar" }],
      subject: "Re: Pricing and volume",
    }),
    false,
  );
  assert.equal(
    matchesEmailAutomation(
      emailAutomationMatchSchema.parse({
        matchMode: "any",
        senderDomain: "eycon.com",
        subjectIncludes: "urgent",
      }),
      {
        from: { address: "damian@eycon.com" },
        to: [{ address: "clara@clasific.ar" }],
        subject: "A normal question",
      },
    ),
    true,
  );
});

test("public automation inputs strip migration-only flags and require workflow CAS", async () => {
  const { automationCreateSchema, automationUpdateSchema } =
    await import("../lib/api-schemas/automation.ts");
  const agentId = "11111111-1111-4111-8111-111111111111";
  const step = {
    id: "draft",
    type: "agent_task",
    agentId,
    action: "draft_reply",
    legacyUnrestricted: true,
    prompt: "Draft a reply.",
  };
  const created = automationCreateSchema.parse({
    name: "Inbound reply",
    agentId,
    triggerType: "email",
    cronExpression: null,
    emailAccountId: "account-1",
    prompt: "Draft a reply.",
    mode: "task",
    steps: [step],
  });
  assert.equal("legacyUnrestricted" in created.steps[0], false);

  assert.equal(
    automationUpdateSchema.safeParse({ mode: "review" }).success,
    false,
  );
  const updated = automationUpdateSchema.parse({
    expectedWorkflowVersion: 2,
    steps: [step],
  });
  assert.equal("legacyUnrestricted" in updated.steps[0], false);
  assert.equal(
    automationUpdateSchema.safeParse({ enabled: false }).success,
    true,
  );
  assert.equal(
    automationUpdateSchema.safeParse({ prompt: "Change the instructions." })
      .success,
    false,
  );
  assert.equal(
    automationUpdateSchema.safeParse({ scheduleTimezone: "Europe/Paris" })
      .success,
    false,
  );
  assert.equal(
    automationUpdateSchema.safeParse({
      expectedWorkflowVersion: 2,
      scheduleTimezone: "Europe/Paris",
    }).success,
    true,
  );
});

test("workflow policy constraints preserve legacy behavior and restrict new replies", async () => {
  const { emailWorkflowPolicyConstraints } =
    await import("../lib/email-workflow-prompt.ts");
  const agentId = "11111111-1111-4111-8111-111111111111";
  assert.equal(
    emailWorkflowPolicyConstraints({
      id: "legacy",
      type: "agent_task",
      agentId,
      action: "analyze",
      legacyUnrestricted: true,
      prompt: "Keep the previous automation behavior.",
    }),
    null,
  );
  assert.deepEqual(
    emailWorkflowPolicyConstraints({
      id: "reply",
      type: "agent_review",
      agentId,
      action: "review_and_reply",
      prompt: "Review and reply.",
    })?.email.tools,
    {
      email_send: "deny",
      email_create_draft: "deny",
    },
  );
});

test("migration converts existing email automations into one-step workflows", async (t) => {
  const { knex } = await temporaryDatabase(t, "slab-email-workflow-migrate-");
  const target = "202608280033_knowledge_source_access.cjs";
  for (;;) {
    const [batch, migrations] = await knex.migrate.up();
    assert.ok(batch > 0 || migrations.length > 0);
    if (migrations.some((migration) => migration.endsWith(target))) break;
  }
  const timestamp = "2026-08-28T12:00:00.000Z";
  const agentId = "11111111-1111-4111-8111-111111111111";
  await knex("agents").insert({
    id: agentId,
    name: "Clara",
    slug: "clara",
    role: "Follow-up",
    instructions: "Follow up",
    runtime: "codex",
    model: "default",
    enabled: 1,
    created_at: timestamp,
    updated_at: timestamp,
  });
  await knex("automations").insert({
    id: "automation-legacy",
    name: "Legacy inbox",
    agent_id: agentId,
    trigger_type: "email",
    cron_expression: null,
    email_account_id: "account-1",
    prompt: "Triage the email.",
    mode: "task",
    enabled: 1,
    created_at: timestamp,
    updated_at: timestamp,
  });

  await knex.migrate.latest();
  const automation = await knex("automations")
    .where("id", "automation-legacy")
    .first();
  assert.equal(automation.workflow_version, 1);
  assert.equal(automation.lifecycle_status, "enabled");
  assert.equal(automation.schedule_timezone, "UTC");
  const occurrenceColumns = await knex("email_automation_occurrences")
    .columnInfo();
  assert.equal(
    Number(
      String(occurrenceColumns.error_attempt_count.defaultValue).replaceAll(
        "'",
        "",
      ),
    ),
    0,
  );
  assert.deepEqual(JSON.parse(automation.email_match_json), {
    recipientAddress: null,
    senderAddress: null,
    senderDomain: null,
    subjectIncludes: null,
  });
  assert.deepEqual(JSON.parse(automation.workflow_steps_json), [
    {
      id: "step-automation-legacy",
      type: "agent_task",
      agentId,
      action: "analyze",
      legacyUnrestricted: true,
      prompt: "Triage the email.",
    },
  ]);
});

test("repository versions workflow edits without versioning scheduler state", async (t) => {
  const { knex, filename } = await temporaryDatabase(
    t,
    "slab-email-workflow-repository-",
  );
  await knex.migrate.latest();
  await knex.destroy();
  process.env.SLAB_WORKSPACE_DB = filename;

  const [{ db }, { automationRepository }] = await Promise.all([
    import("../lib/db/database.ts"),
    import("../lib/repositories/automation-repository.ts"),
  ]);
  t.after(() => db.close());
  const timestamp = "2026-08-28T12:00:00.000Z";
  const agentId = "22222222-2222-4222-8222-222222222222";
  db.prepare(
    `INSERT INTO agents
     (id,name,slug,role,instructions,runtime,model,enabled,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    agentId,
    "Clara",
    "clara-workflow",
    "Follow-up",
    "Follow up",
    "codex",
    "default",
    1,
    timestamp,
    timestamp,
  );
  const reviewerId = "33333333-3333-4333-8333-333333333333";
  db.prepare(
    `INSERT INTO agents
     (id,name,slug,role,instructions,runtime,model,enabled,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    reviewerId,
    "COO",
    "coo-workflow-reviewer",
    "Reviewer",
    "Review replies",
    "codex",
    "default",
    1,
    timestamp,
    timestamp,
  );

  const scheduled = automationRepository.createAutomation({
    name: "Daily review",
    agentId,
    triggerType: "schedule",
    cronExpression: "0 9 * * *",
    emailAccountId: null,
    prompt: "Review operations.",
    mode: "review",
    enabled: true,
  });
  assert.deepEqual(scheduled.steps, []);
  assert.equal(
    automationRepository.updateAutomation(scheduled.id, {
      lastRunAt: timestamp,
    })?.workflowVersion,
    1,
  );

  const email = automationRepository.createAutomation({
    name: "Inbound follow-up",
    agentId,
    triggerType: "email",
    cronExpression: null,
    emailAccountId: "account-1",
    emailMatch: {
      recipientAddress: "clara@clasific.ar",
      senderAddress: null,
      senderDomain: "example.com",
      subjectIncludes: null,
    },
    steps: [
      {
        id: "draft",
        type: "agent_task",
        agentId,
        action: "draft_reply",
        prompt: "Prepare a reply.",
      },
    ],
    prompt: "Prepare a reply.",
    mode: "task",
    enabled: true,
  });
  assert.equal(email.workflowVersion, 1);
  assert.equal(email.steps[0]?.action, "draft_reply");
  const discoveredAt = new Date(
    Date.parse(email.createdAt) + 1_000,
  ).toISOString();
  assert.equal(
    automationRepository.recordEmailEventPage({
      expectedCursor: 0,
      events: [
        {
          id: 1,
          accountId: "account-1",
          provider: "gmail",
          messageId: "wrong-sender",
          threadId: "thread-1",
          from: { address: "sender@other.test" },
          to: [{ address: "clara@clasific.ar" }],
          subject: "Hello",
          receivedAt: timestamp,
          discoveredAt,
        },
        {
          id: 2,
          accountId: "account-1",
          provider: "gmail",
          messageId: "matching-sender",
          threadId: "thread-2",
          from: { address: "sender@example.com" },
          to: [{ address: "clara@clasific.ar" }],
          subject: "Hello",
          receivedAt: timestamp,
          discoveredAt,
        },
      ],
      complete: false,
    }),
    true,
  );
  assert.equal(automationRepository.getEmailOccurrence(email.id, 1), null);
  assert.ok(automationRepository.getEmailOccurrence(email.id, 2));
  assert.equal(
    automationRepository.updateAutomation(email.id, {
      emailMatch: { ...email.emailMatch, senderDomain: "eycon.com" },
    })?.workflowVersion,
    2,
  );
  const reassigned = automationRepository.updateAutomation(email.id, {
    agentId: reviewerId,
    emailAccountId: "account-2",
    steps: [
      {
        ...email.steps[0],
        agentId: reviewerId,
      },
    ],
  });
  assert.equal(reassigned?.agentId, reviewerId);
  assert.equal(reassigned?.emailAccountId, "account-2");
  assert.equal(reassigned?.workflowVersion, 3);

  const modeEdit = automationRepository.updateAutomation(email.id, {
    expectedWorkflowVersion: 3,
    mode: "review",
  });
  assert.equal(modeEdit?.workflowVersion, 4);
  assert.throws(
    () =>
      automationRepository.updateAutomation(email.id, {
        expectedWorkflowVersion: 3,
        mode: "task",
      }),
    (error) => error?.code === "AUTOMATION_VERSION_CONFLICT",
  );

  const firstConcurrentEdit = automationRepository.updateAutomation(email.id, {
    expectedWorkflowVersion: 4,
    emailMatch: { ...email.emailMatch, senderDomain: "first.example" },
  });
  assert.equal(firstConcurrentEdit?.workflowVersion, 5);
  assert.throws(
    () =>
      automationRepository.updateAutomation(email.id, {
        expectedWorkflowVersion: 4,
        emailMatch: { ...email.emailMatch, senderDomain: "stale.example" },
      }),
    (error) => error?.code === "AUTOMATION_VERSION_CONFLICT",
  );
  assert.equal(
    automationRepository.getAutomation(email.id)?.emailMatch.senderDomain,
    "first.example",
  );

  const currentStep = automationRepository.getAutomation(email.id)?.steps[0];
  assert.ok(currentStep);
  db.prepare("UPDATE automations SET workflow_steps_json=? WHERE id=?").run(
    JSON.stringify([
      {
        ...currentStep,
        action: "analyze",
        legacyUnrestricted: true,
      },
    ]),
    email.id,
  );
  const legacy = automationRepository.getAutomation(email.id);
  assert.equal(legacy.steps[0].legacyUnrestricted, true);
  const modeEditedLegacy = automationRepository.updateAutomation(email.id, {
    expectedWorkflowVersion: 5,
    mode: "task",
  });
  assert.equal("legacyUnrestricted" in modeEditedLegacy.steps[0], false);

  db.prepare("UPDATE automations SET workflow_steps_json=? WHERE id=?").run(
    JSON.stringify([{ ...legacy.steps[0], legacyUnrestricted: true }]),
    email.id,
  );
  const filterEditedLegacy = automationRepository.updateAutomation(email.id, {
    expectedWorkflowVersion: 6,
    emailMatch: { ...email.emailMatch, senderDomain: "edited.example" },
  });
  assert.equal("legacyUnrestricted" in filterEditedLegacy.steps[0], false);

  db.prepare("UPDATE automations SET workflow_steps_json=? WHERE id=?").run(
    JSON.stringify([{ ...legacy.steps[0], legacyUnrestricted: true }]),
    email.id,
  );
  const editedLegacy = automationRepository.updateAutomation(email.id, {
    expectedWorkflowVersion: 7,
    steps: [
      {
        ...legacy.steps[0],
        action: "draft_reply",
        prompt: "Draft the current deliverable.",
      },
    ],
  });
  assert.equal("legacyUnrestricted" in editedLegacy.steps[0], false);

  db.prepare("UPDATE automations SET workflow_steps_json=? WHERE id=?").run(
    JSON.stringify([{ ...legacy.steps[0], legacyUnrestricted: true }]),
    email.id,
  );
  const promptEditedLegacy = automationRepository.updateAutomation(email.id, {
    expectedWorkflowVersion: 8,
    prompt: "Use the corrected executable instructions.",
  });
  assert.equal(promptEditedLegacy?.workflowVersion, 9);
  assert.equal(
    promptEditedLegacy?.steps[0]?.prompt,
    "Use the corrected executable instructions.",
  );
  assert.equal(
    promptEditedLegacy?.prompt,
    promptEditedLegacy?.steps[0]?.prompt,
  );
  assert.equal("legacyUnrestricted" in promptEditedLegacy.steps[0], false);

  db.prepare("UPDATE automations SET workflow_steps_json=? WHERE id=?").run(
    JSON.stringify([
      {
        id: "legacy-review",
        type: "agent_task",
        agentId: reviewerId,
        action: "review_and_reply",
        prompt: "Review and reply.",
      },
    ]),
    email.id,
  );
  assert.equal(
    automationRepository.getAutomation(email.id)?.steps[0]?.type,
    "agent_review",
  );
});
