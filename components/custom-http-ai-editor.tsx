"use client";

import { useState } from "react";
import { Check, LoaderCircle, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client-api";
import type {
  CustomHttpAiProposal,
  CustomHttpEditableDefinition,
  CustomHttpIntegrationDraft,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function CustomHttpAiEditor({
  current,
  disabled = false,
  disabledReason,
  onApply,
}: {
  current: CustomHttpEditableDefinition;
  disabled?: boolean;
  disabledReason?: string;
  onApply: (draft: CustomHttpIntegrationDraft) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [documentation, setDocumentation] = useState("");
  const [proposal, setProposal] = useState<CustomHttpAiProposal | null>(null);
  const [generating, setGenerating] = useState(false);

  async function generateProposal() {
    setGenerating(true);
    setProposal(null);
    try {
      const next = await api<CustomHttpAiProposal>(
        "/api/integrations/ai-edit",
        {
          method: "POST",
          body: JSON.stringify({
            current,
            instruction,
            ...(documentation.trim() ? { documentation } : {}),
          }),
        },
      );
      setProposal(next);
      if (!next.changes.length) {
        toast.info("The assistant did not propose any manifest changes");
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not generate an integration proposal",
      );
    } finally {
      setGenerating(false);
    }
  }

  function applyProposal() {
    if (!proposal?.changes.length) return;
    onApply(proposal.draft);
    setProposal(null);
    setInstruction("");
    toast.success("Proposal applied to the unsaved integration draft");
  }

  return (
    <details className="mb-5 overflow-hidden rounded-lg border bg-muted/20">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-background text-primary">
            <Sparkles className="size-4" />
          </span>
          <span>
            <span className="block text-sm font-semibold">
              Fix or edit with AI
            </span>
            <span className="block text-xs text-muted-foreground">
              Describe a change, inspect its diff, then apply it to this draft.
            </span>
          </span>
        </span>
        <Badge variant="outline">Review first</Badge>
      </summary>

      <div className="space-y-4 border-t bg-background p-4">
        <div className="rounded-md bg-muted/45 p-3 text-xs text-muted-foreground">
          The configured credential is never sent. Common credential patterns
          are redacted from your instruction and optional documentation before
          Codex sees them. The assistant receives no integration tools and
          cannot save, test, or call this integration.
        </div>
        <label className="grid gap-2 text-xs font-semibold">
          What should change?
          <Textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="Fix the API owners operation to use /api/admin/metrics/api-usage/users and keep the existing pagination parameters."
            className="min-h-24 resize-y text-sm font-normal"
            maxLength={4_000}
          />
        </label>
        <label className="grid gap-2 text-xs font-semibold">
          Supporting API documentation (optional)
          <Textarea
            value={documentation}
            onChange={(event) => setDocumentation(event.target.value)}
            placeholder="Paste the relevant endpoint contract. Do not paste credentials."
            className="min-h-28 resize-y font-mono text-xs leading-5"
            maxLength={60_000}
          />
        </label>
        <div className="flex justify-end">
          <div className="grid justify-items-end gap-1">
            <Button
              type="button"
              size="sm"
              onClick={generateProposal}
              disabled={disabled || generating || !instruction.trim()}
            >
              {generating ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Sparkles />
              )}
              {generating ? "Generating proposal…" : "Generate proposal"}
            </Button>
            {disabled && disabledReason ? (
              <p className="max-w-sm text-right text-xs text-muted-foreground">
                {disabledReason}
              </p>
            ) : null}
          </div>
        </div>

        {proposal ? (
          <section
            aria-label="AI integration proposal"
            className="overflow-hidden rounded-lg border"
          >
            <header className="border-b bg-muted/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">Proposed changes</p>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {proposal.runtime.id}
                  {proposal.usage.totalTokens == null
                    ? ""
                    : ` · ${integer.format(proposal.usage.totalTokens)} tokens`}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {proposal.summary}
              </p>
            </header>

            {proposal.changes.length ? (
              <ul className="divide-y">
                {proposal.changes.map((change, index) => (
                  <li
                    key={`${change.operationKey}-${change.field ?? "operation"}-${index}`}
                    className="grid gap-2 p-3 sm:grid-cols-[8rem_minmax(0,1fr)]"
                  >
                    <div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "font-mono text-[10px] uppercase",
                          change.kind === "added" &&
                            "border-success/35 bg-success/10 text-success",
                          change.kind === "removed" &&
                            "border-destructive/35 bg-destructive/10 text-destructive",
                        )}
                      >
                        {change.kind}
                      </Badge>
                      <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                        {change.operationKey}
                        {change.field ? `.${change.field}` : ""}
                      </p>
                    </div>
                    <div className="min-w-0 space-y-1 font-mono text-xs">
                      {change.before != null ? (
                        <p className="break-words rounded bg-destructive/5 px-2 py-1 text-destructive">
                          <span aria-hidden="true">− </span>
                          {change.before}
                        </p>
                      ) : null}
                      {change.after != null ? (
                        <p className="break-words rounded bg-success/10 px-2 py-1 text-success">
                          <span aria-hidden="true">+ </span>
                          {change.after}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">
                No manifest changes were proposed.
              </p>
            )}

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">
                Applying updates this unsaved form only. Test and save
                separately.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setProposal(null)}
                >
                  <X /> Discard
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={applyProposal}
                  disabled={!proposal.changes.length}
                >
                  <Check /> Apply proposal
                </Button>
              </div>
            </footer>
          </section>
        ) : null}
      </div>
    </details>
  );
}
