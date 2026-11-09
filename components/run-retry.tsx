"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client-api";
import type { RunRetryState } from "@/lib/types";

type RetryResult = {
  strategy: "new_run" | "whatsapp_requeue";
  runId: string | null;
};

/** Failure panel with the retry action (or why retrying is not possible). */
export function RunRetryPanel({
  runId,
  trigger,
  retry,
}: {
  runId: string;
  trigger: string;
  retry: RunRetryState;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [queued, setQueued] = useState(false);
  const whatsapp = trigger === "whatsapp";

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const result = await api<RetryResult>(`/api/runs/${runId}/retry`, {
        method: "POST",
      });
      if (result.runId) {
        router.push(`/runs/${result.runId}`);
        return;
      }
      setQueued(true);
      router.refresh();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not retry the run.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (retry.status === "retried" || queued)
    return (
      <p className="text-sm text-muted-foreground">
        {retry.status === "retried" && retry.retryRunId ? (
          <>
            Retried as{" "}
            <Link
              className="font-mono underline underline-offset-2"
              href={`/runs/${retry.retryRunId}`}
            >
              run {retry.retryRunId.slice(0, 12)}
            </Link>
            .
          </>
        ) : (
          "Retry queued. The chat will answer these messages on its next turn."
        )}
      </p>
    );

  if (retry.status === "unavailable")
    return (
      <p className="text-sm text-muted-foreground">
        Retry unavailable: {retry.reason}
      </p>
    );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            Retry run
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retry this run?</AlertDialogTitle>
            <AlertDialogDescription>
              {whatsapp
                ? "The customer messages from this turn go back to the chat queue and auto replies resume for this chat. The agent answers them, together with any message that arrived since, using the automation's current rules and approvals."
                : "A new run starts with the same agent, conversation, input and instructions. The agent starts over, so actions the failed run already completed may be repeated."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void submit()}>
              Retry run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
