"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Code2, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client-api";
import type { CodeRepository, CodeRun } from "@/lib/coding/types";

const labelClass =
  "grid gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground";

export function StartCodingRunDialog({
  issueKey,
  projectKey,
  trigger,
}: {
  /** Preselected Work item. When missing, the dialog asks for it. */
  issueKey?: string;
  projectKey?: string | null;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [repositories, setRepositories] = useState<CodeRepository[] | null>(null);
  /** Selected repositories in selection order; the first one is the primary repository. */
  const [repositoryIds, setRepositoryIds] = useState<string[]>([]);
  const [key, setKey] = useState(issueKey ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    api<CodeRepository[]>("/api/coding/repositories")
      .then((items) => {
        if (!active) return;
        const enabled = items.filter((item) => item.enabled);
        setRepositories(enabled);
        const project = (projectKey ?? issueKey?.split("-")[0] ?? "").toUpperCase();
        const matching = enabled.filter((item) => item.workProjectKey === project);
        const preferred = matching.length ? matching : enabled.slice(0, 1);
        setRepositoryIds((current) => (current.length ? current : preferred.map((item) => item.id)));
      })
      .catch((reason: Error) => active && setError(reason.message));
    return () => {
      active = false;
    };
  }, [open, issueKey, projectKey]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const run = await api<CodeRun>("/api/coding/runs", {
        method: "POST",
        body: JSON.stringify({ issueKey: key, repositoryIds, note }),
      });
      toast.success(`Coding run #${run.number} started`);
      setOpen(false);
      router.push(`/coding/${run.number}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start the run.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setError("");
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="outline" size="sm">
            <Code2 />
            Start coding run
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Start a coding run</DialogTitle>
            <DialogDescription>
              Slab prepares a branch, runs PM → Tech spec → Plan review →
              Engineer → Code review, and opens a draft pull request after you
              approve it.
            </DialogDescription>
          </DialogHeader>
          <label className={labelClass}>
            Work item
            <Input
              value={key}
              onChange={(event) => setKey(event.target.value.toUpperCase())}
              placeholder="CC-42"
              required
              disabled={Boolean(issueKey) || busy}
            />
          </label>
          <div className={labelClass}>
            Repositories
            {repositories && repositories.length === 0 ? (
              <p className="text-sm font-normal normal-case tracking-normal text-muted-foreground">
                No repository is configured. Add one in{" "}
                <Link className="underline" href="/coding/settings">
                  Coding settings
                </Link>
                .
              </p>
            ) : !repositories ? (
              <p className="text-sm font-normal normal-case tracking-normal text-muted-foreground">Loading…</p>
            ) : (
              <div className="grid gap-1 rounded-md border p-2 font-normal normal-case tracking-normal">
                {repositories.map((repository) => {
                  const position = repositoryIds.indexOf(repository.id);
                  return (
                    <label key={repository.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--accent)]"
                        checked={position >= 0}
                        disabled={busy || (position < 0 && repositoryIds.length >= 5)}
                        onChange={(event) =>
                          setRepositoryIds((current) =>
                            event.target.checked
                              ? [...current, repository.id]
                              : current.filter((id) => id !== repository.id),
                          )
                        }
                      />
                      <span className="font-mono">{repository.fullName}</span>
                      {position === 0 && repositoryIds.length > 1 && (
                        <span className="text-xs text-muted-foreground">primary</span>
                      )}
                    </label>
                  );
                })}
                <p className="px-1.5 pt-1 text-xs text-muted-foreground">
                  The agents can change every selected repository. Slab opens one draft PR per repository with changes. The first one you select is the primary repository.
                </p>
              </div>
            )}
          </div>
          <label className={labelClass}>
            Note for the PM (optional)
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Constraints, links, or the outcome you expect."
              className="min-h-24 font-normal normal-case tracking-normal"
              disabled={busy}
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={busy || !repositoryIds.length || !key.trim()}>
              {busy && <LoaderCircle className="animate-spin" />}
              Start run
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
