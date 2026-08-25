const SENSITIVE_KEY =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|secret|password)$/i;

export function redactIntegrationText(value: string, secrets: string[] = []) {
  let redacted = value;
  for (const secret of secrets.filter(Boolean)) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted.replace(
    /("(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|secret|password)"\s*:\s*")[^"]*/gi,
    "$1[REDACTED]",
  );
}

export function sanitizeIntegrationValue(
  value: unknown,
  secrets: string[] = [],
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === "string") return redactIntegrationText(value, secrets);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeIntegrationValue(item, secrets, seen));
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key)
        ? "[REDACTED]"
        : sanitizeIntegrationValue(item, secrets, seen),
    ]),
  );
}
