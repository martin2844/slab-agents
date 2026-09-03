import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Runs refresh uses the bounded activity contract without losing stable data", async () => {
  const [route, view] = await Promise.all([
    read("app/api/runs/route.ts"),
    read("components/runs-view.tsx"),
  ]);

  assert.match(
    route,
    /activity \? getRunsActivityData\(\) : getRunsPageData\(\)/,
  );
  assert.match(view, /api<Partial<RunsData>>\("\/api\/runs\?activity=1"\)/);
  assert.match(view, /previous\.runs\.filter/);
  assert.match(view, /agents: next\.agents \?\? previous\.agents/);
  assert.match(view, /const runs = data\?\.runs \?\? \[\]/);
  assert.match(view, /const approvals = data\?\.approvals \?\? \[\]/);
  assert.match(view, /const agents = data\?\.agents \?\? \[\]/);
  assert.match(view, /const conversations = data\?\.conversations \?\? \[\]/);
  assert.match(view, /groupRunHistory\(runs\)/);
  assert.doesNotMatch(view, /data\?\.agents\.find/);
});

test("Runs groups chat executions by product conversation while preserving drill-down", async () => {
  const [view, data, repository] = await Promise.all([
    read("components/runs-view.tsx"),
    read("lib/page-data.ts"),
    read("lib/repositories/conversation-repository.ts"),
  ]);

  assert.match(view, /Run \/ conversation/);
  assert.match(view, /entry\.kind === "conversation"/);
  assert.match(view, /expandedConversations/);
  assert.match(view, /\/runs\/\$\{run\.id\}/);
  assert.match(data, /conversations: conversationRepository/);
  assert.match(repository, /listThreadsByIds/);
});

test("Runs expose their existing product chat without creating another run", async () => {
  const [view, detail, threadPage] = await Promise.all([
    read("components/runs-view.tsx"),
    read("components/run-detail.tsx"),
    read("app/agents/[id]/threads/[threadId]/page.tsx"),
  ]);

  for (const source of [view, detail]) {
    assert.match(source, /\/agents\/\$\{[^}]+\}\/threads\/\$\{[^}]+\}/);
    assert.match(source, /\?run=\$\{[^}]+\}/);
    assert.match(source, /Open chat/);
  }
  assert.match(threadPage, /runRepository\.getActiveRunForThread\(threadId\)/);
  assert.match(threadPage, /linkedRun\?\.threadId === threadId/);
  assert.doesNotMatch(view, /POST[\s\S]*\/api\/threads/);
  assert.doesNotMatch(detail, /POST[\s\S]*\/api\/threads/);
});

test("Background chat polling observes terminal run state before reloading messages", async () => {
  const chat = await read("components/thread-chat.tsx");

  const runFetch = chat.indexOf("/api/runs/${backgroundRunId}");
  const threadFetch = chat.indexOf("/api/threads/${threadId}");

  assert.notEqual(runFetch, -1);
  assert.notEqual(threadFetch, -1);
  assert.ok(runFetch < threadFetch);
  assert.doesNotMatch(
    chat,
    /Promise\.all\(\[\s*api<ThreadData>[\s\S]*api<RunDetailData>/,
  );
  assert.match(chat, /throw await apiClientError\(response\)/);
  assert.doesNotMatch(chat, /new Error\(body\.error/);
});

test("Thread chat reveals each new approval without pinning scroll to polling updates", async () => {
  const chat = await read("components/thread-chat.tsx");

  assert.match(chat, /pendingApprovalId = approval\?\.approvalId;/);
  assert.match(
    chat,
    /useEffect\(\(\) => \{\s*if \(!pendingApprovalId\) return;\s*bottomRef\.current\?\.scrollIntoView\(\{ behavior: "smooth" \}\);\s*\}, \[pendingApprovalId\]\);/,
  );
  assert.doesNotMatch(chat, /\}, \[approval\]\);/);
});
