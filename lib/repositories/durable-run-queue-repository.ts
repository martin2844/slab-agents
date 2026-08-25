import "server-only";

import { db } from "@/lib/db/database";
import { RunQueueRepository } from "@/lib/repositories/run-queue-repository";

const queueState = globalThis as unknown as {
  slabRunQueueRepository?: RunQueueRepository;
};

export const durableRunQueue = (queueState.slabRunQueueRepository ??=
  new RunQueueRepository(db));
