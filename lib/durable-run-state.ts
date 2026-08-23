import "server-only";

import { db } from "@/lib/db";
import { DurableRunQueue } from "@/lib/durable-run-queue";

const state = globalThis as unknown as {
  slabDurableRunQueue?: DurableRunQueue;
};

export const durableRunQueue = (state.slabDurableRunQueue ??=
  new DurableRunQueue(db));
