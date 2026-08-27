import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("System is a first-class authenticated workspace destination", async () => {
  const [navigation, navItem, store, page] = await Promise.all([
    read("components/workspace-shell.tsx"),
    read("components/system-update-nav-item.tsx"),
    read("components/system-updates-store.tsx"),
    read("app/system/page.tsx"),
  ]);

  assert.doesNotMatch(navigation, /href: "\/system", label: "System"/);
  assert.equal(navigation.match(/<SystemUpdateNavItem/g)?.length, 2);
  assert.match(navigation, /<SystemUpdatesStoreProvider>/);
  assert.match(navItem, /href="\/system"/);
  assert.match(navItem, /useSystemUpdatesStore/);
  assert.match(navItem, /deriveSystemUpdateSidebarState/);
  assert.match(navItem, /Installed \$\{version\}/);
  assert.match(navItem, /updateState\.attention/);
  assert.match(navItem, /rounded-full/);
  assert.match(navItem, /aria-hidden="true"/);
  assert.match(navItem, /Bridge offline/);
  assert.match(store, /pathname\.startsWith\("\/system"\) \? 3_000 : 60_000/);
  assert.match(page, /getSystemUpdatesData/);
  assert.match(page, /<SystemUpdatesView initialData=/);
  assert.match(page, /dynamic = "force-dynamic"/);
});

test("the update dashboard exposes inventory while keeping apply atomic", async () => {
  const view = await read("components/system-updates-view.tsx");

  for (const component of ["agents", "work", "docs", "email", "runner"]) {
    assert.match(view, new RegExp(`\\b${component}:`));
  }
  assert.match(view, /Installed/);
  assert.match(view, /Channel target/);
  assert.match(view, /Update the whole Slab stack\?/);
  assert.match(view, /Agents, Work, Docs, Email, and Runner/);
  assert.match(view, /submit\("apply", applyTarget\)/);
  assert.doesNotMatch(view, /submit\("apply", component/);
  assert.match(view, /Automatic rollback is not compatible/);
});

test("automatic updates are clearly stable-only and policy changes are guarded", async () => {
  const [view, store, route] = await Promise.all([
    read("components/system-updates-view.tsx"),
    read("components/system-updates-store.tsx"),
    read("app/api/system/updates/route.ts"),
  ]);

  assert.match(view, /Stable only/);
  assert.match(view, /Candidate releases are never applied automatically/);
  assert.match(view, /expectedVersion: policyDraft\.version/);
  assert.match(view, /checkHourUtc: policyDraft\.checkHourUtc/);
  assert.doesNotMatch(view, /useOperationalPolling/);
  assert.match(view, /useSystemUpdatesStore/);
  assert.match(view, /commitData/);
  assert.match(view, /forceNextPolicySync\(\)/);
  assert.match(store, /SystemUpdatesDataCoordinator/);
  assert.match(
    store,
    /setData\(dataCoordinatorRef\.current\.seed\(initialData\)\)/,
  );
  assert.match(route, /policySchema/);
  assert.match(route, /expectedVersion: z\.number\(\)\.int\(\)\.positive\(\)/);
});

test("the browser is limited to the constrained update API", async () => {
  const [view, readme] = await Promise.all([
    read("components/system-updates-view.tsx"),
    read("README.md"),
  ]);

  assert.match(view, /api<SystemUpdateRequest>\("\/api\/system\/updates"/);
  assert.doesNotMatch(view, /docker\.sock|child_process|exec\(|spawn\(/i);
  assert.match(readme, /never receives the Docker socket or a host shell/);
  assert.match(readme, /small, fixed JSON request/);
});

test("consumed checks, automatic decisions, and risky applies are explicit", async () => {
  const [view, viewModel] = await Promise.all([
    read("components/system-updates-view.tsx"),
    read("lib/system-update-view-model.ts"),
  ]);

  assert.match(view, /Fresh inventory required/);
  assert.match(viewModel, /apply_submitted/);
  assert.match(viewModel, /case "up_to_date"/);
  assert.match(viewModel, /case "unsafe"/);
  assert.match(viewModel, /case "not_applicable"/);
  assert.match(viewModel, /followUpRequestId/);
  assert.match(view, /Automatic rollback is not compatible/);
  assert.match(
    view,
    /<AlertDialogDescription>[\s\S]*Automatic rollback is not compatible[\s\S]*<\/AlertDialogDescription>/,
  );
});
