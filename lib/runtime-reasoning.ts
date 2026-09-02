export const reasoningEfforts = [
  "default",
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ReasoningEffort = (typeof reasoningEfforts)[number];

export const codexSelectableModels = [
  "default",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
] as const;

const baselineEfforts: ReasoningEffort[] = [
  "default",
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
];

export function reasoningEffortsForModel(model: string): ReasoningEffort[] {
  if (model.startsWith("gpt-5.6")) return [...reasoningEfforts];
  if (model === "gpt-5.4" || model === "gpt-5.5") {
    return [...baselineEfforts];
  }
  return ["default", "low", "medium", "high"];
}

export function reasoningEffortLabel(effort: ReasoningEffort) {
  switch (effort) {
    case "default":
      return "Runtime default";
    case "none":
      return "None";
    case "xhigh":
      return "Extra high";
    case "max":
      return "Maximum";
    default:
      return effort.charAt(0).toUpperCase() + effort.slice(1);
  }
}
