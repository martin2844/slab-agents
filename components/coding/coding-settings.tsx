"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, LoaderCircle, Pencil, Plus, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { CodexAuthSettings } from "@/components/codex-auth-settings";
import { PageHeader } from "@/components/page-header";
import { SectionHeader } from "@/components/operational-ui";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client-api";
import { STAGE_DEFINITIONS, type AgentStage } from "@/lib/coding/stages";
import type { CodeRepository } from "@/lib/coding/types";
import type { Agent, GitHubRepositoryOption } from "@/lib/types";

type GithubApp = {
  id: string;
  name: string;
  accountLogin: string | null;
  status: string;
  installed: boolean;
};

type StageMapping = {
  stage: AgentStage;
  reference: string;
  agent: { id: string; name: string; slug: string; enabled: boolean } | null;
};

type RunnerHealth = { reachable: boolean; url: string; profile: string | null; error?: string };

type Draft = {
  id: string | null;
  sourceAppId: string;
  owner: string;
  name: string;
  defaultBranch: string;
  setupCommand: string;
  testCommand: string;
  lintCommand: string;
  typecheckCommand: string;
  setupNotes: string;
  workProjectKey: string;
  enabled: boolean;
};

const emptyDraft: Draft = {
  id: null,
  sourceAppId: "",
  owner: "",
  name: "",
  defaultBranch: "main",
  setupCommand: "",
  testCommand: "",
  lintCommand: "",
  typecheckCommand: "",
  setupNotes: "",
  workProjectKey: "",
  enabled: true,
};

const labelClass = "grid gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground";

function RepositoryDialog({
  draft,
  apps,
  onClose,
  onSaved,
}: {
  draft: Draft | null;
  apps: GithubApp[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [value, setValue] = useState<Draft>(draft ?? emptyDraft);
  const [loaded, setLoaded] = useState<{ appId: string; items: GitHubRepositoryOption[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const options = loaded && loaded.appId === value.sourceAppId ? loaded.items : null;
  useEffect(() => {
    if (!value.sourceAppId) return;
    let active = true;
    const appId = value.sourceAppId;
    api<GitHubRepositoryOption[]>(`/api/coding/github-apps/${appId}/repositories`)
      .then((items) => active && setLoaded({ appId, items }))
      .catch((reason: Error) => active && setError(reason.message));
    return () => {
      active = false;
    };
  }, [value.sourceAppId]);
  const set = (patch: Partial<Draft>) => setValue((current) => ({ ...current, ...patch }));
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const body = JSON.stringify({
      sourceAppId: value.sourceAppId,
      owner: value.owner,
      name: value.name,
      defaultBranch: value.defaultBranch,
      setupCommand: value.setupCommand || null,
      testCommand: value.testCommand || null,
      lintCommand: value.lintCommand || null,
      typecheckCommand: value.typecheckCommand || null,
      setupNotes: value.setupNotes,
      workProjectKey: value.workProjectKey || null,
      enabled: value.enabled,
    });
    try {
      await api(value.id ? `/api/coding/repositories/${value.id}` : "/api/coding/repositories", {
        method: value.id ? "PUT" : "POST",
        body,
      });
      await onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the repository.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={Boolean(draft)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{value.id ? "Edit repository" : "Add repository"}</DialogTitle>
            <DialogDescription>
              Slab clones the repository with the GitHub App, pushes run branches, and opens draft pull requests.
            </DialogDescription>
          </DialogHeader>
          <label className={labelClass}>
            GitHub App
            <Select value={value.sourceAppId} onValueChange={(sourceAppId) => set({ sourceAppId })}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a GitHub App" />
              </SelectTrigger>
              <SelectContent>
                {apps.map((app) => (
                  <SelectItem key={app.id} value={app.id} disabled={!app.installed}>
                    {app.name} {app.accountLogin ? `(${app.accountLogin})` : ""} {!app.installed ? "— not installed" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className={labelClass}>
            Repository
            <Select
              value={value.owner && value.name ? `${value.owner}/${value.name}` : ""}
              onValueChange={(fullName) => {
                const option = options?.find((item) => item.fullName === fullName);
                const [owner, name] = fullName.split("/");
                set({ owner: owner ?? "", name: name ?? "", defaultBranch: option?.defaultBranch ?? value.defaultBranch });
              }}
              disabled={!options}
            >
              <SelectTrigger>
                <SelectValue placeholder={value.sourceAppId ? (options ? "Choose a repository" : "Loading…") : "Choose a GitHub App first"} />
              </SelectTrigger>
              <SelectContent>
                {(options ?? []).map((option) => (
                  <SelectItem key={option.id} value={option.fullName}>
                    {option.fullName}
                  </SelectItem>
                ))}
                {value.owner && value.name && !options?.some((item) => item.fullName === `${value.owner}/${value.name}`) && (
                  <SelectItem value={`${value.owner}/${value.name}`}>{`${value.owner}/${value.name}`}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              Default branch
              <Input value={value.defaultBranch} onChange={(event) => set({ defaultBranch: event.target.value })} required />
            </label>
            <label className={labelClass}>
              Work project (default repo for)
              <Input value={value.workProjectKey} onChange={(event) => set({ workProjectKey: event.target.value.toUpperCase() })} placeholder="CC" />
            </label>
            <label className={labelClass}>
              Setup command
              <Input value={value.setupCommand} onChange={(event) => set({ setupCommand: event.target.value })} placeholder="pnpm install --frozen-lockfile" className="font-mono" />
            </label>
            <label className={labelClass}>
              Test command
              <Input value={value.testCommand} onChange={(event) => set({ testCommand: event.target.value })} placeholder="pnpm test" className="font-mono" />
            </label>
            <label className={labelClass}>
              Lint command
              <Input value={value.lintCommand} onChange={(event) => set({ lintCommand: event.target.value })} placeholder="pnpm lint" className="font-mono" />
            </label>
            <label className={labelClass}>
              Typecheck command
              <Input value={value.typecheckCommand} onChange={(event) => set({ typecheckCommand: event.target.value })} placeholder="pnpm tsc --noEmit" className="font-mono" />
            </label>
          </div>
          <label className={labelClass}>
            Setup notes (the engineer agent keeps them up to date)
            <Textarea value={value.setupNotes} onChange={(event) => set({ setupNotes: event.target.value })} className="min-h-24 font-mono text-xs normal-case tracking-normal" />
          </label>
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={value.enabled} onCheckedChange={(enabled) => set({ enabled })} /> Enabled for new coding runs
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={saving || !value.sourceAppId || !value.owner || !value.name}>
              {saving && <LoaderCircle className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CodingSettings({
  initialRepositories,
  agents,
}: {
  initialRepositories: CodeRepository[];
  agents: Agent[];
}) {
  const [repositories, setRepositories] = useState(initialRepositories);
  const [apps, setApps] = useState<GithubApp[]>([]);
  const [mapping, setMapping] = useState<StageMapping[] | null>(null);
  const [health, setHealth] = useState<RunnerHealth | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    const [nextRepositories, nextApps, nextMapping, nextHealth] = await Promise.all([
      api<CodeRepository[]>("/api/coding/repositories"),
      api<GithubApp[]>("/api/coding/github-apps"),
      api<StageMapping[]>("/api/coding/agents"),
      api<RunnerHealth>("/api/coding/runner/health"),
    ]);
    setRepositories(nextRepositories);
    setApps(nextApps);
    setMapping(nextMapping);
    setHealth(nextHealth);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(
      () => void load().catch((error: Error) => toast.error(error.message)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [load]);

  async function createAgents() {
    setBusy(true);
    try {
      const result = await api<{ created: number; mapping: StageMapping[] }>("/api/coding/agents", { method: "POST" });
      setMapping(result.mapping);
      // The agent options come from the server render: refresh them to include the new agents.
      router.refresh();
      toast.success(result.created ? `Created ${result.created} coding agent(s)` : "All coding agents already exist");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the agents");
    } finally {
      setBusy(false);
    }
  }

  async function assign(stage: AgentStage, agentId: string) {
    try {
      setMapping(await api<StageMapping[]>("/api/coding/agents", { method: "PUT", body: JSON.stringify({ [stage]: agentId }) }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    }
  }

  async function remove(repository: CodeRepository) {
    if (!window.confirm(`Remove ${repository.fullName}?`)) return;
    try {
      await api(`/api/coding/repositories/${repository.id}`, { method: "DELETE" });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the repository");
    }
  }

  return (
    <div className="grid gap-8">
      <div>
        <Link href="/coding" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Coding runs
        </Link>
        <PageHeader eyebrow="Coding" title="Coding settings" description="The code runner, its Codex login, the repositories coding runs can change, and the agent of each stage." />
      </div>

      <section>
        <SectionHeader title="Code runner" meta={health?.url} />
        <div className="grid gap-4 rounded-lg border bg-card p-4">
          {health ? (
            health.reachable ? (
              <p className="flex items-center gap-2 text-sm">
                <StatusBadge status={health.profile === "code" ? "connected" : "error"} />
                {health.profile === "code"
                  ? "slab-runner-code is reachable."
                  : "The runner at this URL does not run the code profile (RUNNER_PROFILE=code)."}
              </p>
            ) : (
              <p className="text-sm text-destructive">{health.error}</p>
            )
          ) : (
            <p className="text-sm text-muted-foreground">Checking…</p>
          )}
          <p className="text-xs text-muted-foreground">
            The code runner is a separate container with its own Codex login. Configure it with CODE_RUNNER_URL and CODE_RUNNER_TOKEN_FILE.
          </p>
          {health?.reachable && health.profile === "code" && (
            <CodexAuthSettings registered apiBase="/api/coding/runner/auth" onAuthenticationChanged={load} />
          )}
        </div>
      </section>

      <section>
        <SectionHeader
          title="Repositories"
          meta={`${repositories.length} configured`}
          action={
            <Button size="sm" onClick={() => setDraft({ ...emptyDraft })} disabled={!apps.some((app) => app.installed)}>
              <Plus /> Add repository
            </Button>
          }
        />
        {!apps.some((app) => app.installed) && (
          <p className="mb-3 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
            Connect and install a GitHub App in{" "}
            <Link href="/sources" className="underline">
              Sources
            </Link>{" "}
            first. Apps created before Coding need the new permissions (contents write, pull requests, issues, checks): accept them on GitHub.
          </p>
        )}
        <div className="grid gap-2">
          {repositories.map((repository) => (
            <div key={repository.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-mono text-sm">
                  {repository.fullName}
                  <StatusBadge status={repository.enabled ? "enabled" : "disabled"} />
                  {repository.workProjectKey && <span className="text-xs text-muted-foreground">Work: {repository.workProjectKey}</span>}
                </p>
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                  {repository.defaultBranch} · setup {repository.setupCommand ?? "—"} · test {repository.testCommand ?? "—"}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setDraft({
                  id: repository.id,
                  sourceAppId: repository.sourceAppId,
                  owner: repository.owner,
                  name: repository.name,
                  defaultBranch: repository.defaultBranch,
                  setupCommand: repository.setupCommand ?? "",
                  testCommand: repository.testCommand ?? "",
                  lintCommand: repository.lintCommand ?? "",
                  typecheckCommand: repository.typecheckCommand ?? "",
                  setupNotes: repository.setupNotes,
                  workProjectKey: repository.workProjectKey ?? "",
                  enabled: repository.enabled,
                })}>
                  <Pencil /> Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void remove(repository)}>
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader
          title="Stage agents"
          meta="Each stage runs as a normal Slab agent. Edit their instructions and models on the Agents page."
          action={
            <Button size="sm" variant="outline" onClick={() => void createAgents()} disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Wand2 />} Create default agents
            </Button>
          }
        />
        <div className="grid gap-2 rounded-lg border bg-card p-3">
          {(mapping ?? []).map((item) => (
            <div key={item.stage} className="grid items-center gap-2 sm:grid-cols-[12rem_1fr]">
              <span className="text-sm font-[600]">{STAGE_DEFINITIONS[item.stage].name}</span>
              <Select value={item.agent?.id ?? ""} onValueChange={(agentId) => void assign(item.stage, agentId)}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={`Missing: ${item.reference}`} />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name} ({agent.slug}){agent.enabled ? "" : " — disabled"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </section>

      <RepositoryDialog
        key={draft ? (draft.id ?? "new") : "closed"}
        draft={draft}
        apps={apps}
        onClose={() => setDraft(null)}
        onSaved={load}
      />
    </div>
  );
}
