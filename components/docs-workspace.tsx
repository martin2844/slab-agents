"use client";
/* eslint-disable react-hooks/set-state-in-effect -- remote document selection intentionally resets local editor state */
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Archive,
  ChevronRight,
  FilePlus2,
  FileText,
  History,
  LoaderCircle,
  PanelLeftClose,
  PlugZap,
  Search,
} from "lucide-react";
import { toast } from "sonner";
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
import {
  Dialog,
  DialogContent,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { api } from "@/lib/client-api";
import { formatDateTime } from "@/lib/utils";
import type {
  DocsDetail,
  DocsPageData,
  Document,
  DocumentRevision,
  DocumentSearchResult,
  DocumentSummary,
  SetupStatus,
} from "@/lib/types";
type Detail = DocsDetail;

function CreateDocument({
  documents,
  onCreated,
  label = "New document",
  variant = "default",
}: {
  documents: DocumentSummary[];
  onCreated: (doc: Document) => void;
  label?: string;
  variant?: "default" | "outline";
}) {
  const [open, setOpen] = useState(false),
    [parent, setParent] = useState("root"),
    [saving, setSaving] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const form = new FormData(e.currentTarget);
    try {
      const doc = await api<Document>("/api/docs", {
        method: "POST",
        body: JSON.stringify({
          title: form.get("title"),
          body: form.get("body") ?? "",
          parent_id: parent === "root" ? null : parent,
          tags: String(form.get("tags") ?? "")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        }),
      });
      onCreated(doc);
      setOpen(false);
      toast.success("Document created");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not create document",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant}>
          <FilePlus2 />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-hidden sm:max-w-2xl">
        <form
          onSubmit={submit}
          className="flex min-h-0 max-h-[calc(100dvh-4rem)] flex-col"
        >
          <DialogHeader className="shrink-0">
            <DialogTitle className="font-heading text-3xl">
              New document
            </DialogTitle>
          </DialogHeader>
          <div className="mt-6 grid min-h-0 flex-1 gap-5 overflow-y-auto pr-1">
            <label className="grid gap-2 text-sm font-semibold">
              Title
              <Input name="title" required autoFocus />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Parent
              <Select value={parent} onValueChange={setParent}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">Top level</SelectItem>
                  {documents.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Tags
              <Input name="tags" placeholder="sales, handbook" />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Markdown
              <Textarea
                name="body"
                className="h-56 min-h-40 max-h-56 resize-none overflow-y-auto font-mono [field-sizing:fixed]"
                defaultValue="# New document&#10;&#10;Start writing…"
              />
            </label>
          </div>
          <DialogFooter className="mt-6 shrink-0">
            <Button type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create document"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Tree({
  documents,
  parentId = null,
  selected,
  onSelect,
  depth = 0,
}: {
  documents: DocumentSummary[];
  parentId?: string | null;
  selected: string | null;
  onSelect: (id: string) => void;
  depth?: number;
}) {
  return (
    <div role={depth === 0 ? "tree" : "group"}>
      {documents
        .filter((d) => d.parent_id === parentId)
        .map((doc) => (
          <div key={doc.id}>
            <button
              role="treeitem"
              aria-selected={selected === doc.id}
              onClick={() => onSelect(doc.id)}
              className={`flex min-h-8 w-full items-center gap-2 rounded-md pr-2 text-left text-[0.82rem] transition-colors hover:bg-muted ${selected === doc.id ? "bg-muted font-semibold text-foreground" : "text-muted-foreground"}`}
              style={{ paddingLeft: `${8 + depth * 16}px` }}
            >
              <ChevronRight className="size-3.5" />
              <FileText className="size-3.5" />
              <span className="truncate">{doc.title}</span>
            </button>
            <Tree
              documents={documents}
              parentId={doc.id}
              selected={selected}
              onSelect={onSelect}
              depth={depth + 1}
            />
          </div>
        ))}
    </div>
  );
}

export function DocsWorkspace({ initialData }: { initialData: DocsPageData }) {
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(
      initialData.documents,
    ),
    [selected, setSelected] = useState<string | null>(initialData.selected),
    [detail, setDetail] = useState<Detail | null>(initialData.detail),
    [error, setError] = useState(initialData.error),
    [query, setQuery] = useState(""),
    [editing, setEditing] = useState(false),
    [body, setBody] = useState(initialData.detail?.document.body ?? ""),
    [title, setTitle] = useState(initialData.detail?.document.title ?? ""),
    [revision, setRevision] = useState<DocumentRevision | null>(null),
    [searchResults, setSearchResults] = useState<DocumentSearchResult[] | null>(
      null,
    ),
    [searching, setSearching] = useState(false),
    [testing, setTesting] = useState(false),
    skipInitialDetailLoad = useRef(true),
    selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    if (skipInitialDetailLoad.current) {
      skipInitialDetailLoad.current = false;
      return;
    }
    if (!selected) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    api<Detail>(`/api/docs/${selected}`, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setDetail(data);
        setBody(data.document.body);
        setTitle(data.document.title);
        setRevision(null);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [selected]);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      api<DocumentSearchResult[]>(`/api/docs?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      })
        .then((results) => {
          if (!controller.signal.aborted) setSearchResults(results);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);
  const visibleDocuments = searchResults ?? documents ?? [];
  async function save() {
    if (!detail) return;
    const documentId = detail.document.id;
    try {
      const updated = await api<Document>(`/api/docs/${documentId}`, {
        method: "PATCH",
        body: JSON.stringify({ title, body }),
      });
      setDocuments(
        (items) =>
          items?.map((d) => (d.id === updated.id ? updated : d)) ?? null,
      );
      if (selectedRef.current === documentId) {
        setDetail((current) =>
          current?.document.id === documentId
            ? { ...current, document: updated }
            : current,
        );
        setEditing(false);
      }
      toast.success("Document saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  }
  async function archive() {
    if (!detail) return;
    const documentId = detail.document.id;
    try {
      await api(`/api/docs/${documentId}`, { method: "DELETE" });
      const remaining = (documents ?? []).filter((d) => d.id !== documentId);
      setDocuments((current) =>
        (current ?? []).filter((d) => d.id !== documentId),
      );
      setSelected((current) =>
        current === documentId ? (remaining[0]?.id ?? null) : current,
      );
      toast.success("Document archived");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Archive failed");
    }
  }
  async function showRevision(value: string) {
    if (!detail) return;
    const documentId = detail.document.id;
    if (value === "current") {
      setRevision(null);
      return;
    }
    try {
      const loaded = await api<DocumentRevision>(
        `/api/docs/${documentId}/revisions/${value}`,
      );
      if (selectedRef.current === documentId) setRevision(loaded);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load revision");
    }
  }
  async function testConnection() {
    setTesting(true);
    try {
      const result = await api<SetupStatus>("/api/setup/check", {
        method: "POST",
        body: JSON.stringify({ service: "docs" }),
      });
      const check = result.checks.find((item) => item.service === "docs");
      if (check?.state !== "connected")
        throw new Error(check?.detail ?? "Slab Docs is unavailable");
      toast.success("Slab Docs connected");
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not test Slab Docs",
      );
    } finally {
      setTesting(false);
    }
  }
  const addDocument = (doc: Document) => {
    setDocuments((value) => [...(value ?? []), doc]);
    setSelected(doc.id);
  };
  return (
    <>
      <PageHeader
        title="Docs"
        description={`${documents?.length ?? 0} documents · Slab Docs source`}
        actions={
          <CreateDocument documents={documents ?? []} onCreated={addDocument} />
        }
      />
      {error && <ErrorState message={error} />}{" "}
      {!documents && !error && <LoadingState />}
      {documents && (
        <div className="grid min-h-[76vh] overflow-hidden rounded-lg border bg-card lg:grid-cols-[16rem_1fr]">
          <aside className="border-b bg-muted/35 p-2.5 lg:border-b-0 lg:border-r">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search documents"
                className="pl-9"
              />
            </div>
            {query.trim() ? (
              <div aria-busy={searching} className="space-y-1">
                {visibleDocuments.map((document) => (
                  <button
                    key={document.id}
                    onClick={() => setSelected(document.id)}
                    className={`flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[0.82rem] hover:bg-muted ${selected === document.id ? "bg-muted font-semibold text-foreground" : "text-muted-foreground"}`}
                  >
                    <Search className="size-3.5" />
                    <span className="truncate">{document.title}</span>
                  </button>
                ))}
              </div>
            ) : (
              <Tree
                documents={documents ?? []}
                selected={selected}
                onSelect={setSelected}
              />
            )}
            {!visibleDocuments.length && !searching && (
              <p className="p-4 text-sm text-muted-foreground">
                No matching documents.
              </p>
            )}
          </aside>
          <main className="min-w-0">
            {!detail ? (
              <EmptyState
                title={
                  documents.length ? "Select a document" : "No Slab Docs yet"
                }
                description={
                  documents.length
                    ? "Choose from the tree or create a new page."
                    : "Verify the knowledge source, then create the first operational document."
                }
                action={
                  !documents.length ? (
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button
                        variant="outline"
                        onClick={testConnection}
                        disabled={testing}
                      >
                        {testing ? (
                          <LoaderCircle className="animate-spin" />
                        ) : (
                          <PlugZap />
                        )}
                        Test Slab Docs connection
                      </Button>
                      <CreateDocument
                        documents={[]}
                        onCreated={addDocument}
                        label="Create first doc"
                      />
                    </div>
                  ) : undefined
                }
              />
            ) : (
              <>
                <header className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-mono text-[0.68rem] text-muted-foreground">
                      /{detail.document.slug}
                    </p>
                    <h2 className="truncate font-heading text-2xl font-semibold tracking-tight">
                      {detail.document.title}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select defaultValue="current" onValueChange={showRevision}>
                      <SelectTrigger className="w-40">
                        <History />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="current">Current</SelectItem>
                        {detail.revisions.map((r) => (
                          <SelectItem
                            key={r.revision}
                            value={String(r.revision)}
                          >
                            Revision {r.revision}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      onClick={() => setEditing((v) => !v)}
                    >
                      <PanelLeftClose />
                      {editing ? "Preview" : "Edit"}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Archive document"
                        >
                          <Archive />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Archive “{detail.document.title}”?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            It will disappear from the active tree. Its content
                            and revisions remain stored in Slab Docs.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={archive}>
                            Archive
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </header>
                {revision && (
                  <div className="border-b bg-amber-500/10 px-6 py-3 text-xs font-semibold text-amber-900">
                    Viewing revision {revision.revision} from{" "}
                    {formatDateTime(revision.created_at)}
                  </div>
                )}
                <div className="p-4 sm:p-6">
                  {editing && !revision ? (
                    <Tabs defaultValue="write">
                      <TabsList>
                        <TabsTrigger value="write">Write</TabsTrigger>
                        <TabsTrigger value="preview">Preview</TabsTrigger>
                      </TabsList>
                      <TabsContent value="write" className="space-y-4 pt-4">
                        <Input
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          className="font-heading text-lg font-semibold"
                        />
                        <Textarea
                          value={body}
                          onChange={(e) => setBody(e.target.value)}
                          className="min-h-[28rem] resize-y font-mono leading-6"
                        />
                        <Button onClick={save}>Save document</Button>
                      </TabsContent>
                      <TabsContent value="preview" className="pt-4">
                        <article className="markdown">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {body}
                          </ReactMarkdown>
                        </article>
                      </TabsContent>
                    </Tabs>
                  ) : (
                    <article className="markdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {revision?.body ?? detail.document.body}
                      </ReactMarkdown>
                    </article>
                  )}
                </div>
              </>
            )}
          </main>
        </div>
      )}
    </>
  );
}
