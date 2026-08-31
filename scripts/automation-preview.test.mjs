import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./test-alias-loader.mjs", import.meta.url);

const agentId = "11111111-1111-4111-8111-111111111111";

test("automation preview evaluates schedules without creating work", async () => {
  const { POST } = await import("../app/api/automations/preview/route.ts");
  const response = await POST(
    new Request("http://localhost/api/automations/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        triggerType: "schedule",
        cronExpression: "0 9 * * 1",
        scheduleTimezone: "America/Argentina/Buenos_Aires",
      }),
    }),
  );
  assert.equal(response.status, 200);
  const data = (await response.json()).data;
  assert.equal(data.triggerType, "schedule");
  assert.equal(data.nextRuns.length, 3);
  assert.ok(data.nextRuns.every((value) => Number.isFinite(Date.parse(value))));
});

test("automation preview explains whether a sample email would run", async () => {
  const { POST } = await import("../app/api/automations/preview/route.ts");
  const response = await POST(
    new Request("http://localhost/api/automations/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        triggerType: "email",
        emailMatch: {
          matchMode: "all",
          recipientAddress: "support@example.com",
          senderAddress: null,
          senderDomain: "customer.test",
          subjectIncludes: "help",
        },
        steps: [
          {
            id: "triage",
            type: "agent_task",
            agentId,
            action: "analyze",
            prompt: "Triage the request.",
          },
        ],
        sample: {
          senderAddress: "person@customer.test",
          recipientAddresses: ["support@example.com"],
          subject: "Help with an invoice",
        },
      }),
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, {
    triggerType: "email",
    matched: true,
    ruleCount: 3,
    steps: [{ id: "triage", position: 1, action: "analyze", agentId }],
  });
});
