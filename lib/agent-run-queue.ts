type QueueEntry = {
  runId: string;
  resolve: () => void;
};

export class AgentRunQueue {
  private readonly active = new Map<string, string>();
  private readonly waiting = new Map<string, QueueEntry[]>();

  acquire(agentId: string, runId: string) {
    if (!this.active.has(agentId)) {
      this.active.set(agentId, runId);
      return { queued: false, ready: Promise.resolve() };
    }

    let resolve!: () => void;
    const ready = new Promise<void>((accept) => {
      resolve = accept;
    });
    const entries = this.waiting.get(agentId) ?? [];
    entries.push({ runId, resolve });
    this.waiting.set(agentId, entries);
    return { queued: true, ready };
  }

  release(agentId: string, runId: string) {
    if (this.active.get(agentId) !== runId) return;
    const entries = this.waiting.get(agentId);
    const next = entries?.shift();
    if (!next) {
      this.active.delete(agentId);
      this.waiting.delete(agentId);
      return;
    }
    this.active.set(agentId, next.runId);
    if (entries?.length) this.waiting.set(agentId, entries);
    else this.waiting.delete(agentId);
    next.resolve();
  }

  activeRun(agentId: string) {
    return this.active.get(agentId) ?? null;
  }
}
