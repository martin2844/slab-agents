export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { startRunDispatcher } = await import("@/lib/run-dispatcher");
    const { startScheduler } = await import("@/lib/scheduler");
    const { startWorkCoordinator } = await import("@/lib/work-coordination");
    const { startCodingOrchestrator } = await import("@/lib/coding/orchestrator");
    const { startTelegram } = await import("@/lib/telegram/service");
    startRunDispatcher();
    startScheduler();
    startWorkCoordinator();
    startCodingOrchestrator();
    // Telegram polls only when a bot token is saved (Settings → Autonomy).
    startTelegram();
  }
}
