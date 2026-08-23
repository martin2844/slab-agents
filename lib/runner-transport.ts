import { advanceRunnerEventCursor } from "./run-recovery-state.ts";

export type RunnerEvent = {
  id: number;
  type:
    | "run.started"
    | "context.bootstrap"
    | "thread.created"
    | "assistant.delta"
    | "assistant.completed"
    | "tool.started"
    | "tool.completed"
    | "tool.failed"
    | "runtime.warning"
    | "approval.required"
    | "approval.resolved"
    | "usage.updated"
    | "run.completed"
    | "run.failed"
    | "run.cancelled";
  runId: string;
  timestamp: string;
  data: Record<string, unknown>;
};

const terminalEvents = new Set<RunnerEvent["type"]>([
  "run.completed",
  "run.failed",
  "run.cancelled",
]);

function parseEventBlock(block: string): RunnerEvent | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data || data === "[DONE]") return null;
  try {
    return JSON.parse(data) as RunnerEvent;
  } catch {
    return null;
  }
}

async function* parseEventStream(
  response: Response,
): AsyncGenerator<RunnerEvent> {
  if (!response.body) throw new Error("Runner returned an empty event stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const event = parseEventBlock(block);
      if (event) yield event;
    }
    if (done) break;
  }
  const event = parseEventBlock(buffer);
  if (event) yield event;
}

type RunnerTransportInput = {
  baseUrl: string;
  runId: string;
  headers: Record<string, string>;
  afterEventId?: number;
  fetcher?: typeof fetch;
  errorFromResponse: (response: Response) => Promise<Error>;
  retryDelay?: (attempt: number) => Promise<void>;
};

export class RunnerStreamInterruptedError extends Error {
  constructor(
    message = "Runner event stream was interrupted before the run completed.",
  ) {
    super(message);
    this.name = "RunnerStreamInterruptedError";
  }
}

function retryDelay(input: RunnerTransportInput, attempt: number) {
  return (
    input.retryDelay?.(attempt) ??
    new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt))
  );
}

function runnerHistoryIsUnavailable(response: Response) {
  return response.status === 404 || response.status === 410;
}

function runnerEvents(input: RunnerTransportInput) {
  const fetcher = input.fetcher ?? fetch;
  return (async function* events(): AsyncGenerator<RunnerEvent> {
    let lastEventId = input.afterEventId ?? 0;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let eventResponse: Response;
      try {
        eventResponse = await fetcher(
          `${input.baseUrl}/runs/${encodeURIComponent(input.runId)}/events`,
          {
            headers: {
              ...input.headers,
              Accept: "text/event-stream",
              ...(lastEventId ? { "Last-Event-ID": String(lastEventId) } : {}),
            },
            cache: "no-store",
          },
        );
      } catch {
        if (attempt === 3) throw new RunnerStreamInterruptedError();
        await retryDelay(input, attempt);
        continue;
      }
      if (!eventResponse.ok) {
        if (runnerHistoryIsUnavailable(eventResponse)) {
          throw await input.errorFromResponse(eventResponse);
        }
        if (attempt === 3) throw new RunnerStreamInterruptedError();
        await retryDelay(input, attempt);
        continue;
      }
      try {
        for await (const event of parseEventStream(eventResponse)) {
          const nextEventId = advanceRunnerEventCursor(lastEventId, event.id);
          if (nextEventId === null) continue;
          lastEventId = nextEventId;
          yield event;
          if (terminalEvents.has(event.type)) return;
        }
      } catch (error) {
        if (
          error instanceof Error &&
          /Runner event history is incomplete/.test(error.message)
        ) {
          throw new RunnerStreamInterruptedError(error.message);
        }
        if (attempt === 3) throw new RunnerStreamInterruptedError();
      }
      if (attempt < 3) {
        await retryDelay(input, attempt);
      }
    }
    throw new RunnerStreamInterruptedError();
  })();
}

export async function attachRunnerTransport(input: RunnerTransportInput) {
  const fetcher = input.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(
      `${input.baseUrl}/runs/${encodeURIComponent(input.runId)}/attach`,
      {
        method: "POST",
        headers: input.headers,
        cache: "no-store",
      },
    );
  } catch {
    throw new RunnerStreamInterruptedError();
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    if (response.status === 410) {
      throw await input.errorFromResponse(response);
    }
    throw new RunnerStreamInterruptedError();
  }
  let acknowledgement: { runId?: string; status?: string };
  try {
    acknowledgement = (await response.json()) as {
      runId?: string;
      status?: string;
    };
  } catch {
    throw new RunnerStreamInterruptedError();
  }
  if (acknowledgement.runId !== input.runId) {
    throw new RunnerStreamInterruptedError();
  }
  return {
    resumed: true as const,
    runnerStatus: acknowledgement.status ?? "running",
    events: runnerEvents(input),
  };
}

export async function createRunnerTransport(
  input: RunnerTransportInput & { body: string },
) {
  const fetcher = input.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(`${input.baseUrl}/runs`, {
      method: "POST",
      headers: input.headers,
      body: input.body,
      cache: "no-store",
    });
  } catch {
    throw new RunnerStreamInterruptedError();
  }
  if (!response.ok) {
    if (response.status === 400 || response.status === 410) {
      throw await input.errorFromResponse(response);
    }
    throw new RunnerStreamInterruptedError();
  }
  let acknowledgement: { runId?: string; status?: string };
  try {
    acknowledgement = (await response.json()) as {
      runId?: string;
      status?: string;
    };
  } catch {
    throw new RunnerStreamInterruptedError();
  }
  if (acknowledgement.runId !== input.runId) {
    throw new RunnerStreamInterruptedError();
  }
  return {
    resumed: false as const,
    runnerStatus: acknowledgement.status ?? "running",
    events: runnerEvents({ ...input, afterEventId: 0 }),
  };
}
