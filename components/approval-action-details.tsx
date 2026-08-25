import type { Approval } from "@/lib/types";

type EmailAction = {
  kind?: unknown;
  from?: unknown;
  to?: unknown;
  cc?: unknown;
  bcc?: unknown;
  subject?: unknown;
  body?: unknown;
};

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function ApprovalActionDetails({
  approval,
  compact = false,
}: {
  approval: Pick<Approval, "command" | "details">;
  compact?: boolean;
}) {
  const action = approval.details.emailAction as EmailAction | undefined;
  if (!action) {
    return (
      <pre className="overflow-auto rounded-md bg-petrol-deep p-3 font-mono text-xs text-white">
        {approval.command}
      </pre>
    );
  }

  const to = strings(action.to);
  const cc = strings(action.cc);
  const bcc = strings(action.bcc);
  const actionComplete =
    typeof action.from === "string" &&
    action.from.length > 0 &&
    to.length > 0 &&
    typeof action.subject === "string" &&
    action.subject.length > 0 &&
    typeof action.body === "string" &&
    action.body.length > 0 &&
    (action.kind !== "reply" || to.length === 1);
  return (
    <div className="overflow-hidden rounded-md border border-amber-800/20 bg-background text-sm">
      <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-b p-3">
        <dt className="text-muted-foreground">From (SMTP)</dt>
        <dd className="break-all font-mono text-xs font-semibold">
          {typeof action.from === "string" ? action.from : "Unavailable"}
        </dd>
        <dt className="text-muted-foreground">To</dt>
        <dd className="break-all font-mono text-xs">{to.join(", ") || "—"}</dd>
        {!compact && cc.length > 0 && (
          <>
            <dt className="text-muted-foreground">Cc</dt>
            <dd className="break-all font-mono text-xs">{cc.join(", ")}</dd>
          </>
        )}
        {!compact && bcc.length > 0 && (
          <>
            <dt className="text-muted-foreground">Bcc</dt>
            <dd className="break-all font-mono text-xs">{bcc.join(", ")}</dd>
          </>
        )}
        {typeof action.subject === "string" && (
          <>
            <dt className="text-muted-foreground">Subject</dt>
            <dd className="font-medium">{action.subject}</dd>
          </>
        )}
      </dl>
      {!actionComplete && (
        <p className="border-b bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Approval is disabled because the runtime did not provide an exact
          sender, recipient, subject, and body.
        </p>
      )}
      {!compact && typeof action.body === "string" && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap p-3 font-sans text-sm leading-5">
          {action.body}
        </pre>
      )}
    </div>
  );
}
