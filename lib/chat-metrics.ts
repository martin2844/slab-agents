import type { Message } from "@/lib/types";

export function formatReplyDuration(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return null;
  if (milliseconds < 1_000) return "<1s";

  const totalSeconds = Math.round(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function buildReplyDurations(messages: Message[]) {
  const requestStartedAt = new Map<string, number>();
  const durations = new Map<string, string>();

  for (const message of messages) {
    if (!message.runId) continue;

    if (message.role === "user") {
      const timestamp = Date.parse(message.createdAt);
      if (Number.isFinite(timestamp)) {
        requestStartedAt.set(message.runId, timestamp);
      }
      continue;
    }

    if (message.role !== "assistant") continue;
    const startedAt = requestStartedAt.get(message.runId);
    const completedAt = Date.parse(message.createdAt);
    if (startedAt === undefined || !Number.isFinite(completedAt)) continue;

    const duration = formatReplyDuration(completedAt - startedAt);
    if (duration) durations.set(message.id, duration);
  }

  return durations;
}
