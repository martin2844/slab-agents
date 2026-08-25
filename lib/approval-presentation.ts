type ApprovalPresentation = {
  command: string;
  details: Record<string, unknown>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function addressList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function text(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function emailWriteTool(data: Record<string, unknown>) {
  if (data.tool === "email_send" || data.tool === "email_reply") {
    return data.tool;
  }
  const message = String(data.message ?? data.command ?? "");
  const match = /tool ["'](email_send|email_reply)["']/i.exec(message);
  return match?.[1]?.toLowerCase() as "email_send" | "email_reply" | undefined;
}

export function presentApproval(
  data: Record<string, unknown>,
): ApprovalPresentation {
  const fallback = String(
    data.command ??
      data.reason ??
      data.message ??
      data.description ??
      "Runtime action",
  );
  if (data.server !== "email") return { command: fallback, details: data };
  const tool = emailWriteTool(data);
  if (!tool) {
    return { command: fallback, details: data };
  }

  const args = record(data.toolArguments);
  const from = typeof args.expectedFrom === "string" ? args.expectedFrom : "";
  const to = addressList(args.to);
  const cc = addressList(args.cc);
  const bcc = addressList(args.bcc);
  const subject = text(
    tool === "email_reply" ? args.expectedSubject : args.subject,
  );
  const body = text(args.text);
  const messageId =
    typeof args.messageId === "string" ? args.messageId : undefined;
  const action = tool === "email_reply" ? "Reply to email" : "Send email";
  const safeDetails = { ...data };
  delete safeDetails.toolArguments;

  return {
    command: from
      ? `${action} as ${from}${to.length ? ` to ${to.join(", ")}` : ""}`
      : `${action} (sender identity unavailable)`,
    details: {
      ...safeDetails,
      tool,
      emailAction: {
        kind: tool === "email_reply" ? "reply" : "send",
        from: from || null,
        to,
        cc,
        bcc,
        subject: subject || null,
        body: body || null,
        ...(messageId ? { messageId } : {}),
        senderMustMatchConnector: true,
      },
    },
  };
}

export function approvalCanBeApproved(details: Record<string, unknown>) {
  if (details.server !== "email") return true;
  const tool = emailWriteTool(details);
  if (!tool) return true;
  const action = record(details.emailAction);
  const recipients = addressList(action.to);
  return (
    typeof action.from === "string" &&
    action.from.length > 0 &&
    recipients.length > 0 &&
    typeof action.subject === "string" &&
    action.subject.length > 0 &&
    typeof action.body === "string" &&
    action.body.length > 0 &&
    (tool !== "email_reply" || recipients.length === 1)
  );
}
