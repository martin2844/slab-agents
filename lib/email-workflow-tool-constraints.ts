import "server-only";

import { createHash } from "node:crypto";

export const EMAIL_REPLY_ACCOUNT_HEADER = "X-Slab-Reply-Account-Sha256";
export const EMAIL_REPLY_MESSAGE_HEADER = "X-Slab-Reply-Message-Sha256";

export type EmailReplyToolConstraint = {
  accountId: string;
  messageId: string;
};

function safeHeaderValue(value: unknown, maximumLength: number) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    !/[\r\n]/.test(value)
    ? value
    : null;
}

export function parseEmailReplyToolConstraint(
  value: unknown,
): EmailReplyToolConstraint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const accountId = safeHeaderValue(record.accountId, 200);
  const messageId = safeHeaderValue(record.messageId, 2_048);
  return accountId && messageId ? { accountId, messageId } : null;
}

export function emailReplyConstraintHeaders(
  constraint: EmailReplyToolConstraint,
) {
  const digest = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  return {
    [EMAIL_REPLY_ACCOUNT_HEADER]: digest(constraint.accountId),
    [EMAIL_REPLY_MESSAGE_HEADER]: digest(constraint.messageId),
  };
}
