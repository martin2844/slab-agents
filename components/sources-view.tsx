"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BookOpenText,
  CheckCircle2,
  GitBranch,
  Globe2,
  LoaderCircle,
  Pencil,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
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
import { api } from "@/lib/client-api";
import type {
  GitHubRepositoryOption,
  GitHubSourceApp,
  KnowledgeSource,
  KnowledgeSourceKind,
  SourcesPageData,
} from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import {
  DEFAULT_GITHUB_SOURCE_SELECTORS,
  GITHUB_DOCUMENT_EXTENSIONS,
} from "@/lib/sources/github-files";

type SourceDraft = {
  id?: string;
  version?: number;
  accessVersion?: number;
  agentIds: string[];
  kind: KnowledgeSourceKind;
  name: string;
  enabled: boolean;
  syncIntervalMinutes: string;
  secret: string;
  authType: "none" | "basic" | "bearer" | "github_app";
  siteUrl: string;
  sitemapUrl: string;
  username: string;
  repository: string;
  branch: string;
  githubAppId: string;
  contentTypes: string;
  pathPrefixes: string;
  extensions: string;
  maxDocuments: string;
};

const fieldClass = "space-y-1.5";
const labelClass = "text-xs font-[550] text-muted-foreground";

function blankDraft(kind: KnowledgeSourceKind): SourceDraft {
  return {
    kind,
    agentIds: [],
    name: "",
    enabled: true,
    syncIntervalMinutes: "360",
    secret: "",
    authType: "none",
    siteUrl: "",
    sitemapUrl: "",
    username: "",
    repository: "",
    branch: "main",
    githubAppId: "",
    contentTypes: "posts, pages",
    pathPrefixes: "",
    extensions:
      kind === "github" ? DEFAULT_GITHUB_SOURCE_SELECTORS.join(", ") : "",
    maxDocuments: kind === "github" ? "500" : "200",
  };
}

function editDraft(source: KnowledgeSource): SourceDraft {
  const draft = blankDraft(source.kind);
  const config = source.config;
  return {
    ...draft,
    id: source.id,
    version: source.version,
    accessVersion: source.accessVersion,
    agentIds: source.agentIds,
    name: source.name,
    enabled: source.enabled,
    syncIntervalMinutes: source.syncIntervalMinutes?.toString() ?? "",
    authType: config.authType,
    maxDocuments: config.maxDocuments.toString(),
    ...(config.kind === "wordpress"
      ? {
          siteUrl: config.siteUrl,
          username: config.username ?? "",
          contentTypes: config.contentTypes.join(", "),
        }
      : config.kind === "github"
        ? {
            repository: config.repository,
            branch: config.branch,
            githubAppId: source.githubAppId ?? "",
            pathPrefixes: config.pathPrefixes.join(", "),
            extensions: config.extensions.join(", "),
          }
        : {
            siteUrl: config.siteUrl,
            sitemapUrl: config.sitemapUrl ?? "",
            username: config.username ?? "",
            pathPrefixes: config.includePathPrefixes.join(", "),
          }),
  };
}

function csv(value: string) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function sourcePayload(draft: SourceDraft) {
  const common = {
    name: draft.name,
    enabled: draft.enabled,
    expectedVersion: draft.version,
    expectedAccessVersion: draft.accessVersion,
    agentIds: draft.agentIds,
    syncIntervalMinutes: draft.syncIntervalMinutes
      ? Number(draft.syncIntervalMinutes)
      : null,
    secret: draft.secret || undefined,
    maxDocuments: Number(draft.maxDocuments),
  };
  if (draft.kind === "wordpress") {
    return {
      ...common,
      kind: draft.kind,
      siteUrl: draft.siteUrl,
      authType: draft.authType === "github_app" ? "none" : draft.authType,
      username: draft.username || null,
      contentTypes: csv(draft.contentTypes),
      publishedOnly: true,
    };
  }
  if (draft.kind === "github") {
    return {
      ...common,
      kind: draft.kind,
      repository: draft.repository,
      branch: draft.branch,
      authType: draft.authType,
      githubAppId: draft.githubAppId || null,
      pathPrefixes: csv(draft.pathPrefixes),
      extensions: csv(draft.extensions),
    };
  }
  return {
    ...common,
    kind: draft.kind,
    siteUrl: draft.siteUrl,
    sitemapUrl: draft.sitemapUrl || null,
    authType: draft.authType === "github_app" ? "none" : draft.authType,
    username: draft.username || null,
    includePathPrefixes: csv(draft.pathPrefixes),
  };
}

function SourceStatus({ source }: { source: KnowledgeSource }) {
  if (source.status === "healthy")
    return <Badge variant="signal">Healthy</Badge>;
  if (source.status === "syncing") return <Badge>Syncing</Badge>;
  if (source.status === "error")
    return <Badge variant="destructive">Error</Badge>;
  if (source.status === "deleting")
    return <Badge variant="secondary">Deleting</Badge>;
  if (source.status === "disabled")
    return <Badge variant="secondary">Disabled</Badge>;
  return <Badge variant="outline">Never synced</Badge>;
}

export function SourcesView({
  initialData,
  notice,
}: {
  initialData: SourcesPageData;
  notice: { type: "success" | "error"; message: string } | null;
}) {
  const [data, setData] = useState(initialData);
  const [draft, setDraft] = useState<SourceDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [githubOpen, setGithubOpen] = useState(false);
  const [githubName, setGithubName] = useState("Slab Sources");
  const [githubOrganization, setGithubOrganization] = useState("");

  useEffect(() => {
    if (!notice) return;
    toast[notice.type](notice.message);
  }, [notice]);

  async function reload() {
    setData(await api<SourcesPageData>("/api/sources"));
  }

  async function sourceAction(id: string, verb: "test" | "sync") {
    setBusy(`${verb}:${id}`);
    try {
      const result = await api<Record<string, unknown>>(
        `/api/sources/${id}/${verb}`,
        { method: "POST" },
      );
      toast.success(
        verb === "sync" ? "Source synchronized" : "Connection verified",
        {
          description:
            verb === "sync"
              ? `${result.created ?? 0} created · ${result.updated ?? 0} updated`
              : undefined,
        },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `${verb} failed`);
    } finally {
      try {
        await reload();
      } catch (error) {
        toast.error("Could not refresh Sources", {
          description:
            error instanceof Error
              ? error.message
              : "Reload the page to retry.",
        });
      } finally {
        setBusy(null);
      }
    }
  }

  async function remove(source: KnowledgeSource) {
    if (
      !window.confirm(
        `Delete ${source.name} and archive its managed documents?`,
      )
    )
      return;
    setBusy(`delete:${source.id}`);
    try {
      await api(`/api/sources/${source.id}`, {
        method: "DELETE",
        body: JSON.stringify({
          expectedVersion: source.version,
          archiveDocuments: true,
        }),
      });
      toast.success("Source deleted");
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  async function connectGithub() {
    setBusy("github:create");
    try {
      const result = await api<{
        actionUrl: string;
        manifest: object;
      }>("/api/sources/github/apps", {
        method: "POST",
        body: JSON.stringify({
          name: githubName,
          organization: githubOrganization || null,
        }),
      });
      const form = document.createElement("form");
      form.method = "POST";
      form.action = result.actionUrl;
      const manifest = document.createElement("input");
      manifest.type = "hidden";
      manifest.name = "manifest";
      manifest.value = JSON.stringify(result.manifest);
      form.appendChild(manifest);
      document.body.appendChild(form);
      form.submit();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "GitHub setup failed",
      );
      setBusy(null);
    }
  }

  async function installGithub(app: GitHubSourceApp) {
    setBusy(`github:install:${app.id}`);
    try {
      const result = await api<{ authorizationUrl: string }>(
        `/api/sources/github/apps/${app.id}/install`,
        { method: "POST" },
      );
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "GitHub install failed",
      );
      setBusy(null);
    }
  }

  async function testGithub(app: GitHubSourceApp) {
    setBusy(`github:test:${app.id}`);
    try {
      const result = await api<{ repositoryCount: number }>(
        `/api/sources/github/apps/${app.id}/test`,
        { method: "POST" },
      );
      toast.success(
        `GitHub connected · ${result.repositoryCount} repositories`,
      );
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Test failed");
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function removeGithub(app: GitHubSourceApp) {
    if (
      !window.confirm(
        `Remove the ${app.name} connection from Slab? GitHub installation access must be revoked separately.`,
      )
    )
      return;
    setBusy(`github:delete:${app.id}`);
    try {
      await api(`/api/sources/github/apps/${app.id}`, { method: "DELETE" });
      toast.success("GitHub App connection removed");
      await reload();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not remove connection",
      );
    } finally {
      setBusy(null);
    }
  }

  const healthy = data.sources.filter(
    (source) => source.status === "healthy",
  ).length;
  const documents = data.sources.reduce(
    (sum, source) => sum + source.itemCount,
    0,
  );

  return (
    <>
      <PageHeader
        title="Sources"
        description={`${data.sources.length} configured · ${healthy} healthy · ${documents} synchronized documents`}
        actions={
          <Button onClick={() => setDraft(blankDraft("wordpress"))}>
            <PlugZap /> Add source
          </Button>
        }
      />

      <section className="min-w-0 overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-[650]">Knowledge sources</h2>
            <p className="text-xs text-muted-foreground">
              External content mirrored into Docs with provenance.
            </p>
          </div>
          <BookOpenText className="size-4 text-muted-foreground" />
        </div>
        {data.sources.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  {[
                    "Source",
                    "Documents",
                    "Status",
                    "Agent access",
                    "Last sync",
                    "Schedule",
                    "Actions",
                  ].map((label) => (
                    <th
                      key={label}
                      className={`px-4 py-2 font-[550] ${label === "Actions" ? "text-right" : ""}`}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.sources.map((source) => (
                  <tr key={source.id} className="hover:bg-muted/25">
                    <td className="px-4 py-3">
                      <div className="font-[600]">{source.name}</div>
                      <div className="mt-0.5 font-mono text-[11px] uppercase text-muted-foreground">
                        {source.kind}
                        {source.config.kind === "github"
                          ? ` · ${source.config.repository}`
                          : ""}
                      </div>
                      {source.lastError && (
                        <p
                          className="mt-1 max-w-md truncate text-xs text-destructive"
                          title={source.lastError}
                        >
                          {source.lastError}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {source.itemCount}
                    </td>
                    <td className="px-4 py-3">
                      <SourceStatus source={source} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {source.agentIds.length
                        ? `${source.agentIds.length} agent${source.agentIds.length === 1 ? "" : "s"}`
                        : "Private"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {source.lastSyncedAt
                        ? formatDateTime(source.lastSyncedAt)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {source.syncIntervalMinutes
                        ? `Every ${source.syncIntervalMinutes}m`
                        : "Manual"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => sourceAction(source.id, "test")}
                          disabled={
                            busy !== null || source.status === "deleting"
                          }
                        >
                          {busy === `test:${source.id}` ? (
                            <LoaderCircle className="animate-spin" />
                          ) : (
                            <CheckCircle2 />
                          )}
                          Test
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => sourceAction(source.id, "sync")}
                          disabled={
                            busy !== null ||
                            !source.enabled ||
                            source.status === "deleting"
                          }
                        >
                          {busy === `sync:${source.id}` ? (
                            <LoaderCircle className="animate-spin" />
                          ) : (
                            <RefreshCw />
                          )}
                          Sync
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Edit ${source.name}`}
                          onClick={() => setDraft(editDraft(source))}
                          disabled={source.status === "deleting"}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Delete ${source.name}`}
                          onClick={() => remove(source)}
                          disabled={busy !== null}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-10 text-center">
            <Globe2 className="mx-auto size-6 text-muted-foreground" />
            <h3 className="mt-3 text-sm font-[650]">No external sources yet</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Connect WordPress, GitHub, or a website sitemap, then choose which
              agents may read it.
            </p>
          </div>
        )}
      </section>

      <section className="mt-5 grid gap-4 lg:grid-cols-[1fr_.72fr]">
        <div className="min-w-0 overflow-hidden rounded-lg border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-[650]">GitHub Apps</h2>
              <p className="text-xs text-muted-foreground">
                Read private repositories without personal access tokens.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setGithubOpen(true)}
            >
              <GitBranch /> Connect
            </Button>
          </div>
          <div className="divide-y">
            {data.githubApps.length ? (
              data.githubApps.map((app) => (
                <div
                  key={app.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-[600]">{app.name}</span>
                      <Badge
                        variant={
                          app.status === "connected"
                            ? "signal"
                            : app.status === "error"
                              ? "destructive"
                              : "outline"
                        }
                      >
                        {app.status.replaceAll("_", " ")}
                      </Badge>
                    </div>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {app.accountLogin ??
                        app.organization ??
                        "Personal account"}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {app.status === "pending_installation" ? (
                      <Button
                        size="sm"
                        onClick={() => installGithub(app)}
                        disabled={busy !== null}
                      >
                        Install repository access
                      </Button>
                    ) : app.status === "connected" || app.status === "error" ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() => testGithub(app)}
                        >
                          Test again
                        </Button>
                        {app.status === "error" && (
                          <Button
                            size="sm"
                            onClick={() => installGithub(app)}
                            disabled={busy !== null}
                          >
                            Reinstall access
                          </Button>
                        )}
                      </>
                    ) : null}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove ${app.name}`}
                      disabled={busy !== null}
                      onClick={() => removeGithub(app)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <p className="px-4 py-5 text-sm text-muted-foreground">
                No GitHub App connection configured.
              </p>
            )}
          </div>
        </div>
        <div className="min-w-0 overflow-hidden rounded-lg border bg-muted/35 p-4">
          <ShieldCheck className="size-5 text-primary" />
          <h2 className="mt-3 text-sm font-[650]">Source boundary</h2>
          <p className="mt-1 break-words text-sm leading-6 text-muted-foreground">
            Credentials stay encrypted in the control plane. GitHub tokens are
            short-lived. Every synchronized document records its origin.
          </p>
        </div>
      </section>

      <section className="mt-5">
        <h2 className="text-sm font-[650]">Add a source</h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          {(
            [
              [
                "wordpress",
                "WordPress",
                "Posts and pages through the standard REST API.",
                Globe2,
              ],
              [
                "github",
                "GitHub repository",
                "Code and documentation from public or private repositories.",
                GitBranch,
              ],
              [
                "website",
                "Website / sitemap",
                "Selected same-origin pages from an XML sitemap.",
                BookOpenText,
              ],
            ] as const
          ).map(([kind, title, copy, Icon]) => (
            <button
              key={kind}
              type="button"
              onClick={() => setDraft(blankDraft(kind))}
              className="rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/30"
            >
              <Icon className="size-5" />
              <div className="mt-4 text-sm font-[650]">{title}</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {copy}
              </p>
            </button>
          ))}
        </div>
      </section>

      {draft && (
        <SourceEditor
          key={draft.id ?? `new-${draft.kind}`}
          initialDraft={draft}
          apps={data.githubApps}
          agents={data.agents}
          onClose={() => setDraft(null)}
          onSaved={async () => {
            setDraft(null);
            await reload();
          }}
        />
      )}

      <Dialog open={githubOpen} onOpenChange={setGithubOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect a GitHub App</DialogTitle>
            <DialogDescription>
              GitHub creates a read-only App, then asks which repositories it
              may access.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="App name" htmlFor="github-app-name">
              <Input
                id="github-app-name"
                value={githubName}
                onChange={(event) => setGithubName(event.target.value)}
              />
            </Field>
            <Field label="Organization (optional)" htmlFor="github-org">
              <Input
                id="github-org"
                placeholder="Leave empty for your personal account"
                value={githubOrganization}
                onChange={(event) => setGithubOrganization(event.target.value)}
              />
            </Field>
            <div className="rounded-md border bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">
              <ShieldCheck className="mr-1 inline size-3.5" /> Read-only
              repository contents and metadata. The private key stays encrypted.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGithubOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={connectGithub}
              disabled={!githubName.trim() || busy !== null}
            >
              {busy === "github:create" && (
                <LoaderCircle className="animate-spin" />
              )}
              Continue to GitHub
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({
  label,
  htmlFor,
  className = "",
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`${fieldClass} ${className}`}>
      <label className={labelClass} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

function SourceEditor({
  initialDraft,
  apps,
  agents,
  onClose,
  onSaved,
}: {
  initialDraft: SourceDraft;
  apps: GitHubSourceApp[];
  agents: SourcesPageData["agents"];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [value, setValue] = useState<SourceDraft>(initialDraft);
  const [saving, setSaving] = useState(false);
  const [repositories, setRepositories] = useState<GitHubRepositoryOption[]>(
    [],
  );
  const connectedApps = useMemo(
    () =>
      apps.filter(
        (app) =>
          app.status === "connected" || app.id === initialDraft.githubAppId,
      ),
    [apps, initialDraft.githubAppId],
  );
  const githubAppId = value?.githubAppId;
  const authType = value?.authType;
  const kind = value?.kind;
  useEffect(() => {
    if (kind !== "github" || authType !== "github_app" || !githubAppId) return;
    let cancelled = false;
    api<GitHubRepositoryOption[]>(
      `/api/sources/github/apps/${githubAppId}/repositories`,
    )
      .then((rows) => {
        if (!cancelled) setRepositories(rows);
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not load repositories",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [kind, authType, githubAppId]);

  const set = <K extends keyof SourceDraft>(key: K, next: SourceDraft[K]) =>
    setValue((current) => ({ ...current, [key]: next }));
  const secretNeeded =
    value.authType === "basic" || value.authType === "bearer";

  async function save() {
    setSaving(true);
    try {
      const saved = await api<KnowledgeSource>(
        value!.id ? `/api/sources/${value!.id}` : "/api/sources",
        {
          method: value!.id ? "PATCH" : "POST",
          body: JSON.stringify(sourcePayload(value!)),
        },
      );
      if (!value.id && saved.enabled) {
        try {
          await api(`/api/sources/${saved.id}/sync`, { method: "POST" });
          toast.success("Source created and synchronized");
        } catch (error) {
          toast.warning("Source saved, but its initial sync failed", {
            description:
              error instanceof Error ? error.message : "Retry from Sources.",
          });
        }
      } else {
        toast.success(value.id ? "Source updated" : "Source created");
      }
      await onSaved();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save source",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {value.id ? "Edit" : "Add"}{" "}
            {value.kind === "github"
              ? "GitHub repository"
              : value.kind === "wordpress"
                ? "WordPress source"
                : "website source"}
          </DialogTitle>
          <DialogDescription>
            Content remains read-only at the origin and is mirrored into Docs.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="source-name" className="sm:col-span-2">
            <Input
              id="source-name"
              value={value.name}
              onChange={(event) => set("name", event.target.value)}
              placeholder="Product handbook"
            />
          </Field>

          {value.kind !== "github" ? (
            <>
              <Field
                label={
                  value.kind === "wordpress"
                    ? "WordPress site URL"
                    : "Website URL"
                }
                htmlFor="source-url"
                className="sm:col-span-2"
              >
                <Input
                  id="source-url"
                  value={value.siteUrl}
                  onChange={(event) => set("siteUrl", event.target.value)}
                  placeholder="https://example.com"
                />
              </Field>
              {value.kind === "website" && (
                <Field
                  label="Sitemap URL (optional)"
                  htmlFor="sitemap-url"
                  className="sm:col-span-2"
                >
                  <Input
                    id="sitemap-url"
                    value={value.sitemapUrl}
                    onChange={(event) => set("sitemapUrl", event.target.value)}
                    placeholder="https://example.com/sitemap.xml"
                  />
                </Field>
              )}
            </>
          ) : (
            <GitHubFields
              value={value}
              set={set}
              apps={connectedApps}
              repositories={repositories}
            />
          )}

          {value.kind === "wordpress" && (
            <Field label="Content types" htmlFor="content-types">
              <Input
                id="content-types"
                value={value.contentTypes}
                onChange={(event) => set("contentTypes", event.target.value)}
              />
            </Field>
          )}

          {value.kind !== "github" && (
            <Field label="Authentication" htmlFor="source-auth">
              <Select
                value={value.authType}
                onValueChange={(next) =>
                  set("authType", next as SourceDraft["authType"])
                }
              >
                <SelectTrigger id="source-auth" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="basic">
                    Basic / application password
                  </SelectItem>
                  <SelectItem value="bearer">Bearer token</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}

          {value.authType === "basic" && (
            <Field label="Username" htmlFor="username">
              <Input
                id="username"
                value={value.username}
                onChange={(event) => set("username", event.target.value)}
              />
            </Field>
          )}
          {secretNeeded && (
            <Field
              label={value.id ? "Replace secret (optional)" : "Secret"}
              htmlFor="source-secret"
            >
              <Input
                id="source-secret"
                type="password"
                autoComplete="new-password"
                value={value.secret}
                onChange={(event) => set("secret", event.target.value)}
                placeholder={
                  value.id
                    ? "Configured · leave blank to keep"
                    : "Stored encrypted"
                }
              />
            </Field>
          )}
          {value.kind !== "wordpress" && (
            <Field
              label="Included paths (comma separated, optional)"
              htmlFor="paths"
              className="sm:col-span-2"
            >
              <Input
                id="paths"
                value={value.pathPrefixes}
                onChange={(event) => set("pathPrefixes", event.target.value)}
                placeholder="docs, handbook"
              />
            </Field>
          )}
          <Field label="Maximum documents" htmlFor="max-docs">
            <Input
              id="max-docs"
              type="number"
              min="1"
              max="500"
              value={value.maxDocuments}
              onChange={(event) => set("maxDocuments", event.target.value)}
            />
          </Field>
          <Field label="Sync every (minutes)" htmlFor="sync-interval">
            <Input
              id="sync-interval"
              type="number"
              min="15"
              placeholder="Empty for manual"
              value={value.syncIntervalMinutes}
              onChange={(event) =>
                set("syncIntervalMinutes", event.target.value)
              }
            />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Switch
              checked={value.enabled}
              onCheckedChange={(checked) => set("enabled", checked)}
            />
            Source enabled
          </label>
          <div className="space-y-2 sm:col-span-2">
            <div>
              <p className={labelClass}>Agent access</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Selected agents can read this source in new runs. Source-managed
                documents remain read-only.
              </p>
            </div>
            <div className="divide-y rounded-md border">
              {agents.length ? (
                agents.map((agent) => (
                  <label
                    key={agent.id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-[600]">
                        {agent.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {agent.role}
                        {!agent.enabled ? " · disabled" : ""}
                      </span>
                    </span>
                    <Switch
                      checked={value.agentIds.includes(agent.id)}
                      onCheckedChange={(checked) =>
                        set(
                          "agentIds",
                          checked
                            ? [...new Set([...value.agentIds, agent.id])]
                            : value.agentIds.filter((id) => id !== agent.id),
                        )
                      }
                      aria-label={`${agent.name} access to ${value.name || "source"}`}
                    />
                  </label>
                ))
              ) : (
                <p className="px-3 py-4 text-sm text-muted-foreground">
                  Create an agent before assigning source access.
                </p>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !value.name.trim()}>
            {saving && <LoaderCircle className="animate-spin" />}{" "}
            {value.id ? "Save source" : "Save and sync"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GitHubFields({
  value,
  set,
  apps,
  repositories,
}: {
  value: SourceDraft;
  set: <K extends keyof SourceDraft>(key: K, next: SourceDraft[K]) => void;
  apps: GitHubSourceApp[];
  repositories: GitHubRepositoryOption[];
}) {
  return (
    <>
      <Field label="Access" htmlFor="github-auth">
        <Select
          value={value.authType}
          onValueChange={(next) =>
            set("authType", next as SourceDraft["authType"])
          }
        >
          <SelectTrigger id="github-auth" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Public repository</SelectItem>
            <SelectItem value="bearer">Fine-grained token</SelectItem>
            <SelectItem value="github_app" disabled={!apps.length}>
              GitHub App
            </SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {value.authType === "github_app" && (
        <Field label="GitHub App" htmlFor="github-app">
          <Select
            value={value.githubAppId}
            onValueChange={(next) => set("githubAppId", next)}
          >
            <SelectTrigger id="github-app" className="w-full">
              <SelectValue placeholder="Choose connection" />
            </SelectTrigger>
            <SelectContent>
              {apps.map((app) => (
                <SelectItem key={app.id} value={app.id}>
                  {app.name} · {app.accountLogin}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      <Field label="Repository" htmlFor="repository" className="sm:col-span-2">
        {value.authType === "github_app" && repositories.length ? (
          <Select
            value={value.repository}
            onValueChange={(next) => {
              const repository = repositories.find(
                (item) => item.fullName === next,
              );
              set("repository", next);
              if (repository) set("branch", repository.defaultBranch);
            }}
          >
            <SelectTrigger id="repository" className="w-full">
              <SelectValue placeholder="Select a repository" />
            </SelectTrigger>
            <SelectContent>
              {repositories.map((repository) => (
                <SelectItem key={repository.id} value={repository.fullName}>
                  {repository.fullName}
                  {repository.private ? " · private" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            id="repository"
            value={value.repository}
            onChange={(event) => set("repository", event.target.value)}
            placeholder="owner/repository"
          />
        )}
      </Field>
      <Field label="Branch" htmlFor="branch">
        <Input
          id="branch"
          value={value.branch}
          onChange={(event) => set("branch", event.target.value)}
        />
      </Field>
      <Field label="File extensions" htmlFor="extensions">
        <Input
          id="extensions"
          value={value.extensions}
          onChange={(event) => set("extensions", event.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            set("pathPrefixes", "");
            set("extensions", DEFAULT_GITHUB_SOURCE_SELECTORS.join(", "));
            set("maxDocuments", "500");
          }}
        >
          Code + docs
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            set("pathPrefixes", "docs, README.md");
            set("extensions", GITHUB_DOCUMENT_EXTENSIONS.join(", "));
          }}
        >
          Docs only
        </Button>
        <p className="text-xs leading-5 text-muted-foreground">
          Code + docs mirrors searchable source files with repository paths.
          Common credential files, dependencies, generated output, lockfiles,
          and binaries stay excluded.
        </p>
      </div>
    </>
  );
}
