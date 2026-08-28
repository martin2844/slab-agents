import "server-only";

import { z } from "zod";

import {
  getInboundEmailAccount,
  isInboundEmailFeedConfigured,
  listInboundEmailEvents,
} from "@/lib/integrations/email-service";
import { automationRepository } from "@/lib/repositories/automation-repository";
import {
  advanceEmailWorkflowExecutions,
  startEmailAutomationRun,
} from "@/lib/email-workflow-execution-service";
import type { InboundEmailEvent } from "@/lib/types";

const PAGE_SIZE = 100;
const MAX_PAGES_PER_TICK = 10;
const MAX_PENDING_PER_TICK = 1_000;
const DISPATCH_CONCURRENCY = 8;
const MAX_RECIPIENTS = 20;
const MAX_EVENT_METADATA_BYTES = 32 * 1_024;

const boundedText = (maxLength: number) =>
  z
    .string()
    .transform((value) =>
      value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, maxLength),
    );
const addressSchema = z.object({
  name: boundedText(100).optional(),
  address: boundedText(254),
});
const recipientListSchema = z.preprocess(
  (value) =>
    Array.isArray(value)
      ? {
          items: value.slice(0, MAX_RECIPIENTS),
          omittedRecipientCount: Math.max(0, value.length - MAX_RECIPIENTS),
        }
      : value,
  z.object({
    items: z.array(addressSchema).max(MAX_RECIPIENTS),
    omittedRecipientCount: z.number().int().nonnegative(),
  }),
);
const inboundEventSchema = z
  .object({
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    accountId: z.string().min(1).max(200),
    provider: z.enum([
      "proton_bridge",
      "imap_smtp",
      "gmail",
      "microsoft_graph",
      "agentmail",
      "resend",
    ]),
    messageId: boundedText(2_000).pipe(z.string().min(1)),
    threadId: boundedText(500).nullable(),
    from: addressSchema,
    to: recipientListSchema,
    subject: boundedText(500),
    receivedAt: boundedText(100),
    discoveredAt: z.string().datetime({ offset: true }),
  })
  .transform(({ to, ...event }) => ({
    ...event,
    to: to.items,
    omittedRecipientCount: to.omittedRecipientCount,
  }))
  .superRefine((event, context) => {
    if (
      Buffer.byteLength(JSON.stringify(event), "utf8") >
      MAX_EVENT_METADATA_BYTES
    ) {
      context.addIssue({
        code: "custom",
        message: "Email event metadata exceeds the aggregate safety bound.",
      });
    }
  });
const pageSchema = z.object({
  items: z.array(inboundEventSchema).max(PAGE_SIZE),
  nextCursor: z.string().nullable(),
});

type Dependencies = {
  listEvents?: typeof listInboundEmailEvents;
  getAccount?: typeof getInboundEmailAccount;
  configured?: typeof isInboundEmailFeedConfigured;
  startOccurrence?: typeof startEmailAutomationRun;
  logError?: (message: string, error: unknown) => void;
};

function defaultLogError(message: string, error: unknown) {
  console.error(message, error);
}

async function dispatchPending(
  startOccurrence: typeof startEmailAutomationRun,
  getAccount: typeof getInboundEmailAccount,
  logError: NonNullable<Dependencies["logError"]>,
) {
  const pending =
    automationRepository.listPendingEmailOccurrences(MAX_PENDING_PER_TICK);
  const preflights = new Map<
    string,
    ReturnType<typeof getInboundEmailAccount>
  >();
  const cachedGetAccount = (accountId: string) => {
    let result = preflights.get(accountId);
    if (!result) {
      result = getAccount(accountId);
      preflights.set(accountId, result);
    }
    return result;
  };
  for (
    let offset = 0;
    offset < pending.length;
    offset += DISPATCH_CONCURRENCY
  ) {
    await Promise.all(
      pending
        .slice(offset, offset + DISPATCH_CONCURRENCY)
        .map(async (occurrence) => {
          try {
            await startOccurrence(
              occurrence.automationId,
              occurrence.inboundEventId,
              { getAccount: cachedGetAccount },
            );
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Email automation dispatch failed.";
            automationRepository.markEmailOccurrenceRetry(
              occurrence.automationId,
              occurrence.inboundEventId,
              occurrence.runId,
              message,
            );
            logError(
              `[scheduler] email automation ${occurrence.automationId} event ${occurrence.inboundEventId}:`,
              error,
            );
          }
        }),
    );
  }
}

const state = globalThis as unknown as {
  slabEmailAutomationTick?: Promise<void>;
};

async function runEmailAutomationTick(dependencies: Dependencies) {
  const configured = dependencies.configured ?? isInboundEmailFeedConfigured;
  const listEvents = dependencies.listEvents ?? listInboundEmailEvents;
  const getAccount = dependencies.getAccount ?? getInboundEmailAccount;
  const startOccurrence =
    dependencies.startOccurrence ?? startEmailAutomationRun;
  const logError = dependencies.logError ?? defaultLogError;

  try {
    await advanceEmailWorkflowExecutions({ getAccount, logError });
  } catch (error) {
    logError("[scheduler] Email workflow advancement:", error);
  }
  if (!configured()) return;

  let cursor = automationRepository.getEmailFeedState()?.cursor ?? 0;
  try {
    for (let page = 0; page < MAX_PAGES_PER_TICK; page += 1) {
      const response = pageSchema.parse(
        await listEvents(cursor, PAGE_SIZE),
      ) as { items: InboundEmailEvent[]; nextCursor: string | null };
      const ids = response.items.map(({ id }) => id);
      if (
        ids.some((id) => id <= cursor) ||
        ids.some((id, index) => index > 0 && id <= ids[index - 1]!)
      ) {
        throw new Error("Email event feed returned an invalid event order.");
      }
      const remoteCursor = response.nextCursor
        ? Number.parseInt(response.nextCursor, 10)
        : null;
      if (
        ids.length > 0 &&
        (!Number.isSafeInteger(remoteCursor) || remoteCursor !== ids.at(-1))
      ) {
        throw new Error("Email event feed returned an invalid cursor.");
      }
      const complete = response.items.length === 0;
      const committed = automationRepository.recordEmailEventPage({
        expectedCursor: cursor,
        events: response.items,
        complete,
      });
      if (!committed) break;
      if (complete) break;
      cursor = ids.at(-1)!;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Email event polling failed.";
    automationRepository.markEmailFeedError(message);
    logError("[scheduler] inbound Email event feed:", error);
  }
  await dispatchPending(startOccurrence, getAccount, logError);
}

export function tickEmailAutomations(dependencies: Dependencies = {}) {
  if (state.slabEmailAutomationTick) return state.slabEmailAutomationTick;
  const task = runEmailAutomationTick(dependencies).finally(() => {
    if (state.slabEmailAutomationTick === task) {
      state.slabEmailAutomationTick = undefined;
    }
  });
  state.slabEmailAutomationTick = task;
  return task;
}
