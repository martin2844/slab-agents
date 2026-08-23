type PersistedRunEvent = {
  type: string;
  payload: Record<string, unknown>;
};

export function restoreRunProgress(events: PersistedRunEvent[]) {
  const lastRuntimeReset = events.findLastIndex(
    (event) => event.type === "runtime_thread_recreated",
  );
  const persistedAssistant = events
    .slice(lastRuntimeReset + 1)
    .findLast((event) => event.type === "assistant_message");
  const assistantBody =
    typeof persistedAssistant?.payload.body === "string"
      ? persistedAssistant.payload.body
      : "";
  const modelCallIndex = events.reduce((maximum, event) => {
    if (event.type !== "usage_updated") return maximum;
    const callIndex = Number(event.payload.callIndex ?? 0);
    return Number.isFinite(callIndex) ? Math.max(maximum, callIndex) : maximum;
  }, 0);
  return { assistantBody, modelCallIndex };
}

export function advanceRunnerEventCursor(current: number, eventId: number) {
  if (eventId <= current) return null;
  if (eventId !== current + 1) {
    throw new Error(
      `Runner event history is incomplete: expected ${current + 1}, received ${eventId}.`,
    );
  }
  return eventId;
}
