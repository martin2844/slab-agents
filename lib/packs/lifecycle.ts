export type PackResourceState = {
  managed: boolean;
  createdByPack: boolean;
  reattachable: boolean;
  state: "applied" | "failed" | "detached";
  baseline: Record<string, unknown>;
};

export type PackResourceDecision =
  "create" | "update" | "preserve" | "conflict" | "unchanged" | "detach";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function samePackSnapshot(left: unknown, right: unknown) {
  return (
    JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
  );
}

export function decidePackResourceChange(input: {
  current?: Record<string, unknown>;
  proposed: Record<string, unknown>;
  resource?: PackResourceState;
}): { action: PackResourceDecision; userModified: boolean } {
  if (!input.current) return { action: "create", userModified: false };
  if (samePackSnapshot(input.current, input.proposed)) {
    if (input.resource?.state === "detached" && input.resource.reattachable) {
      return { action: "update", userModified: false };
    }
    return {
      action: input.resource?.managed ? "unchanged" : "preserve",
      userModified: false,
    };
  }
  if (input.resource?.state === "detached" && input.resource.reattachable) {
    const disabledBaseline = {
      ...input.resource.baseline,
      ...(Object.hasOwn(input.resource.baseline, "enabled")
        ? { enabled: false }
        : {}),
    };
    if (
      samePackSnapshot(input.current, input.resource.baseline) ||
      samePackSnapshot(input.current, disabledBaseline)
    ) {
      return { action: "update", userModified: false };
    }
  }
  if (
    input.resource?.managed &&
    samePackSnapshot(input.current, input.resource.baseline)
  ) {
    return { action: "update", userModified: false };
  }
  return { action: "conflict", userModified: true };
}

export function comparePackVersions(left: string, right: string) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}
