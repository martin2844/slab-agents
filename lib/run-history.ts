import type { Run, RunStatus } from "@/lib/types";

export type RunHistoryEntry =
  | {
      kind: "conversation";
      key: string;
      threadId: string;
      runs: Run[];
      summaryRun: Run;
      status: RunStatus;
    }
  | {
      kind: "run";
      key: string;
      run: Run;
      summaryRun: Run;
      status: RunStatus;
    };

const activeStatusPriority: Partial<Record<RunStatus, number>> = {
  waiting_approval: 0,
  running: 1,
  queued: 2,
};

function conversationStatus(runs: Run[]) {
  const active = runs
    .filter((run) => run.status in activeStatusPriority)
    .sort(
      (left, right) =>
        activeStatusPriority[left.status]! -
        activeStatusPriority[right.status]!,
    )[0];
  return active?.status ?? runs[0]!.status;
}

export function groupRunHistory(runs: Run[]): RunHistoryEntry[] {
  const conversations = new Map<string, { firstIndex: number; runs: Run[] }>();
  const entries: Array<{ index: number; entry: RunHistoryEntry }> = [];

  runs.forEach((run, index) => {
    if (run.mode !== "chat" || !run.threadId) {
      entries.push({
        index,
        entry: {
          kind: "run",
          key: run.id,
          run,
          summaryRun: run,
          status: run.status,
        },
      });
      return;
    }
    const existing = conversations.get(run.threadId);
    if (existing) existing.runs.push(run);
    else conversations.set(run.threadId, { firstIndex: index, runs: [run] });
  });

  for (const [threadId, conversation] of conversations) {
    entries.push({
      index: conversation.firstIndex,
      entry: {
        kind: "conversation",
        key: `conversation:${threadId}`,
        threadId,
        runs: conversation.runs,
        summaryRun: conversation.runs[0]!,
        status: conversationStatus(conversation.runs),
      },
    });
  }

  return entries
    .sort((left, right) => left.index - right.index)
    .map(({ entry }) => entry);
}
