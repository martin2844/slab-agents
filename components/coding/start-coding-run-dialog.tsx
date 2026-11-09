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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const [repositoryId, setRepositoryId] = useState("");
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
        const preferred =
          enabled.find((item) => item.workProjectKey === project) ?? enabled[0];
        setRepositoryId((current) => current || preferred?.id || "");
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
        body: JSON.stringify({ issueKey: key, repositoryId, note }),
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
          <label className={labelClass}>
            Repository
            {repositories && repositories.length === 0 ? (
              <p className="text-sm font-normal normal-case tracking-normal text-muted-foreground">
                No repository is configured. Add one in{" "}
                <Link className="underline" href="/coding/settings">
                  Coding settings
                </Link>
                .
              </p>
            ) : (
              <Select value={repositoryId} onValueChange={setRepositoryId} disabled={busy}>
                <SelectTrigger>
                  <SelectValue placeholder={repositories ? "Choose a repository" : "Loading…"} />
                </SelectTrigger>
                <SelectContent>
                  {(repositories ?? []).map((repository) => (
                    <SelectItem key={repository.id} value={repository.id}>
                      {repository.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </label>
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
            <Button type="submit" disabled={busy || !repositoryId || !key.trim()}>
              {busy && <LoaderCircle className="animate-spin" />}
              Start run
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
