import "server-only";

import { sourceRepository } from "@/lib/repositories/source-repository";
import { syncKnowledgeSource } from "@/lib/sources/service";

const state = globalThis as unknown as { slabSourceSchedulerBusy?: boolean };

export async function tickKnowledgeSources() {
  if (state.slabSourceSchedulerBusy) return;
  state.slabSourceSchedulerBusy = true;
  try {
    const due = sourceRepository.listDueSourceIds(new Date().toISOString(), 2);
    await Promise.all(
      due.map((id) =>
        syncKnowledgeSource(id).catch((error) => {
          console.error(
            `[sources] sync ${id}:`,
            error instanceof Error ? error.message : "failed",
          );
        }),
      ),
    );
  } finally {
    state.slabSourceSchedulerBusy = false;
  }
}
