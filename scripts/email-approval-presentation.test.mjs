import assert from "node:assert/strict";
import test from "node:test";

import {
  approvalCanBeApproved,
  presentApproval,
} from "../lib/approval-presentation.ts";
import { readFile } from "node:fs/promises";

test("email approvals contain explicit sender, recipients, subject, and body", () => {
  const result = presentApproval({
    server: "email",
    tool: "email_send",
    message: 'Allow the email MCP server to run tool "email_send"?',
    toolArguments: {
      accountId: "account-1",
      expectedFrom: "clara@clasific.ar",
      to: ["buyer@example.com"],
      cc: ["ops@example.com"],
      subject: "Follow-up",
      text: "Hello from Clara",
      idempotencyKey: "secret-noise",
    },
  });

  assert.equal(
    result.command,
    "Send email as clara@clasific.ar to buyer@example.com",
  );
  assert.deepEqual(result.details.emailAction, {
    kind: "send",
    from: "clara@clasific.ar",
    to: ["buyer@example.com"],
    cc: ["ops@example.com"],
    bcc: [],
    subject: "Follow-up",
    body: "Hello from Clara",
    senderMustMatchConnector: true,
  });
  assert.equal(approvalCanBeApproved(result.details), true);
  assert.doesNotMatch(JSON.stringify(result.details), /secret-noise/);
});

test("email approvals without an explicit sender fail closed", () => {
  const result = presentApproval({
    server: "email",
    tool: "email_send",
    toolArguments: { to: ["buyer@example.com"], text: "Hello" },
  });
  assert.equal(approvalCanBeApproved(result.details), false);
});

test("email replies without an exact recipient and subject fail closed", () => {
  const result = presentApproval({
    server: "email",
    tool: "email_reply",
    toolArguments: {
      expectedFrom: "clara@clasific.ar",
      text: "Reply body",
    },
  });
  assert.equal(approvalCanBeApproved(result.details), false);
});

test("email approval presents the complete bounded body", () => {
  const body = "x".repeat(3_000);
  const result = presentApproval({
    server: "email",
    tool: "email_send",
    toolArguments: {
      expectedFrom: "clara@clasific.ar",
      to: ["buyer@example.com"],
      subject: "Full body",
      text: body,
    },
  });
  assert.equal(result.details.emailAction.body, body);
  assert.equal(approvalCanBeApproved(result.details), true);
});

test("legacy Email send approvals without correlated tool arguments fail closed", () => {
  const result = presentApproval({
    server: "email",
    message: 'Allow the email MCP server to run tool "email_send"?',
  });
  assert.equal(result.command, "Send email (sender identity unavailable)");
  assert.equal(approvalCanBeApproved(result.details), false);
});

test("non-email approvals keep their provider message", () => {
  const result = presentApproval({ server: "work", message: "Create issue?" });
  assert.equal(result.command, "Create issue?");
});

test("Runs never hides approvable email recipients or body behind compact mode", async () => {
  const source = await readFile("components/runs-view.tsx", "utf8");
  assert.match(source, /<ApprovalActionDetails approval=\{approval\} \/>/);
  assert.doesNotMatch(source, /ApprovalActionDetails approval=\{approval\} compact/);
});
