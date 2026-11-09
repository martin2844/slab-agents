import type { McpToolPolicy } from "@/lib/agent-tool-policy";
const mutations = [
  "create_doc",
  "update_doc",
  "archive_doc",
  "revert_doc_commit",
] as const;
export function docsEditingPlan(policy: McpToolPolicy | undefined) {
  const original = policy ?? { defaultMode: "deny" as const, tools: {} };
  const mode = (tool: string) => original.tools[tool] ?? original.defaultMode;
  // A revert can create, edit or archive multiple documents. It must not become
  // an alternate route around a denied mutation or a required review.
  const revertMode = mutations.slice(0, 3).some((tool) => mode(tool) === "deny")
    ? "deny"
    : mutations.slice(0, 3).some((tool) => mode(tool) === "prompt") &&
        mode("revert_doc_commit") === "approve"
      ? "prompt"
      : mode("revert_doc_commit");
  const resolved = {
    ...original,
    tools: { ...original.tools, revert_doc_commit: revertMode },
  };
  const editingMode = mutations.some(
    (tool) =>
      (resolved.tools[tool as keyof typeof resolved.tools] ??
        resolved.defaultMode) === "prompt",
  )
    ? "review"
    : "auto";
  return {
    editingMode: editingMode as "review" | "auto",
    stagedPolicy: {
      ...resolved,
      tools: {
        ...resolved.tools,
        ...Object.fromEntries(
          mutations.map((tool) => [
            tool,
            (resolved.tools[tool as keyof typeof resolved.tools] ??
              resolved.defaultMode) === "deny"
              ? "deny"
              : "approve",
          ]),
        ),
      },
    } as McpToolPolicy,
  };
}
