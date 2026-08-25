import "server-only";

import { OperationalError } from "@/lib/operational-error";

import { CronExpressionParser } from "cron-parser";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DocsClient } from "@/lib/mcp/docs-client";
import { WorkClient } from "@/lib/mcp/work-client";
import {
  OFFICIAL_OPERATOR_PACKS,
  getOfficialOperatorPack,
} from "@/lib/packs/catalog";
import {
  parseOperatorPackManifest,
  type OperatorPackAcceptanceScenario,
  type OperatorPackManifest,
  type PackCapabilityCategory,
} from "@/lib/packs/manifest";
import {
  evaluateOperatorPackAcceptance,
  findAcceptanceAssignmentRun,
} from "@/lib/packs/acceptance";
import {
  comparePackVersions,
  decidePackResourceChange,
  samePackSnapshot,
} from "@/lib/packs/lifecycle";
import { repository } from "@/lib/repository";
import { getRuntimeConfig, runtimeIds } from "@/lib/runtime-config";
import { createRunExecution, executeRunInBackground } from "@/lib/run-service";
import { getSetupStatus } from "@/lib/setup";
import type {
  Agent,
  AgentQuickAction,
  Automation,
  OperatorPackAcceptance,
  OperatorPackCapabilityState,
  OperatorPackMetrics,
  OperatorPackPreview,
  OperatorPackPreviewChange,
  OperatorPackResource,
  OperatorPackSummary,
  Project,
} from "@/lib/types";
import { tickWorkCoordination } from "@/lib/work-coordination";

const APP_VERSION = String(
  (
    JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { version?: unknown }
  ).version ?? "0.0.0",
);

const packInstallState = globalThis as unknown as {
  operatorPackInstallLocks?: Map<string, Promise<unknown>>;
};
packInstallState.operatorPackInstallLocks ??= new Map();

type PackCatalogEntry = {
  manifest: OperatorPackManifest;
  source: "official" | "local";
};

type ConflictStrategy = "preserve" | "replace";

function agentSnapshot(agent: Agent) {
  return {
    name: agent.name,
    slug: agent.slug,
    role: agent.role,
    instructions: agent.instructions,
    model: agent.model,
    enabled: agent.enabled,
    fullAccess: agent.fullAccess,
  };
}

function actionSnapshot(action: AgentQuickAction) {
  return { label: action.label, prompt: action.prompt };
}

function automationSnapshot(automation: Automation) {
  return {
    name: automation.name,
    cronExpression: automation.cronExpression,
    prompt: automation.prompt,
    mode: automation.mode,
    enabled: automation.enabled,
  };
}

function localCatalog(): PackCatalogEntry[] {
  return repository.listOperatorPackDefinitions().map((definition) => ({
    manifest: parseOperatorPackManifest(definition.manifest),
    source: "local" as const,
  }));
}

export function listOperatorPackCatalog(): PackCatalogEntry[] {
  const official = OFFICIAL_OPERATOR_PACKS.map((manifest) => ({
    manifest,
    source: "official" as const,
  }));
  const officialIds = new Set(official.map(({ manifest }) => manifest.id));
  return [
    ...official,
    ...localCatalog().filter(({ manifest }) => !officialIds.has(manifest.id)),
  ];
}

export function getOperatorPackCatalogEntry(id: string) {
  const official = getOfficialOperatorPack(id);
  if (official) return { manifest: official, source: "official" as const };
  const local = repository.getOperatorPackDefinition(id);
  return local
    ? {
        manifest: parseOperatorPackManifest(local.manifest),
        source: "local" as const,
      }
    : null;
}

function integrationMatchesCapability(
  category: PackCapabilityCategory,
  integration: ReturnType<typeof repository.listIntegrations>[number],
) {
  if (category === "calendar") {
    return integration.provider.startsWith("calendar_");
  }
  if (category === "product_analytics") {
    return integration.provider === "posthog";
  }
  const label = `${integration.slug} ${integration.name}`;
  if (category === "github") return /github/i.test(label);
  if (category === "crm") return /\bcrm\b/i.test(label);
  if (category === "metrics") {
    return /metrics|business intelligence|\bbi\b/i.test(label);
  }
  return /sentry|error monitoring|errors/i.test(label);
}

function packAgents(manifest: OperatorPackManifest) {
  const resources = repository.listOperatorPackResources(manifest.id);
  return manifest.agents.flatMap((template) => {
    const resource = findResource(resources, "agent", template.key);
    const agent = resource?.resourceId
      ? repository.getAgent(resource.resourceId)
      : repository.getAgent(template.slug);
    return agent ? [agent] : [];
  });
}

function capabilityAvailable(
  category: PackCapabilityCategory,
  agents: Agent[],
) {
  const setup = getSetupStatus();
  if (category === "work") {
    return setup.checks.some(
      (check) => check.service === "work" && check.state === "connected",
    );
  }
  if (category === "docs") {
    return setup.checks.some(
      (check) => check.service === "docs" && check.state === "connected",
    );
  }
  if (category === "email") {
    if (repository.getEmailIntegrationRecord()?.status !== "connected") {
      return false;
    }
    return (
      agents.length > 0 &&
      agents.every((agent) => {
        const access = repository.getAgentEmailAccess(agent.id);
        return Boolean(
          access &&
          access.accountIds.length > 0 &&
          (access.readEnabled || access.draftEnabled || access.sendEnabled),
        );
      })
    );
  }
  const integrations = repository
    .listIntegrations()
    .filter(
      (integration) =>
        integration.enabled &&
        integration.status === "connected" &&
        integrationMatchesCapability(category, integration),
    );
  return (
    agents.length > 0 &&
    agents.every((agent) =>
      integrations.some(
        (integration) => (integration.permissions[agent.id] ?? []).length > 0,
      ),
    )
  );
}

export function capabilityStates(manifest: OperatorPackManifest) {
  const agents = packAgents(manifest);
  return manifest.capabilities.map(
    (capability): OperatorPackCapabilityState => ({
      ...capability,
      available: capabilityAvailable(capability.category, agents),
    }),
  );
}

function findResource(
  resources: OperatorPackResource[],
  resourceType: OperatorPackResource["resourceType"],
  resourceKey: string,
) {
  return resources.find(
    (resource) =>
      resource.resourceType === resourceType &&
      resource.resourceKey === resourceKey,
  );
}

function previewChange(input: {
  resourceType: OperatorPackResource["resourceType"];
  resourceKey: string;
  label: string;
  proposed: Record<string, unknown>;
  current?: Record<string, unknown>;
  resource?: OperatorPackResource;
}): OperatorPackPreviewChange {
  return {
    ...input,
    ...(input.resource?.baseline ? { baseline: input.resource.baseline } : {}),
    ...decidePackResourceChange({
      current: input.current,
      proposed: input.proposed,
      resource: input.resource,
    }),
  };
}

function assertPreviewStillCurrent(
  change: OperatorPackPreviewChange,
  current?: Record<string, unknown>,
) {
  if (samePackSnapshot(change.current, current)) return;
  throw new OperationalError(
    `${change.label} changed after preview. Review the latest values and try again.`,
  );
}

function assertManifestRuntimeCompatibility(manifest: OperatorPackManifest) {
  if (
    comparePackVersions(
      APP_VERSION,
      manifest.compatibility.minimumSlabVersion,
    ) < 0
  ) {
    throw new OperationalError(
      `${manifest.name} requires Slab ${manifest.compatibility.minimumSlabVersion} or newer.`,
    );
  }
  for (const automation of manifest.automations) {
    if (automation.cronExpression) {
      CronExpressionParser.parse(automation.cronExpression);
    }
  }
}

function resolvePackAgent(
  template: OperatorPackManifest["agents"][number],
  resource?: OperatorPackResource,
) {
  const tracked = resource?.resourceId
    ? repository.getAgent(resource.resourceId)
    : null;
  if (tracked) {
    const slugOwner = repository.getAgent(template.slug);
    if (slugOwner && slugOwner.id !== tracked.id) {
      throw new OperationalError(
        `Agent slug ${template.slug} is already used by another Agent.`,
      );
    }
    return tracked;
  }
  return repository.getAgent(template.slug);
}

function resolvePackQuickAction(
  agent: Agent | null,
  label: string,
  resource?: OperatorPackResource,
) {
  if (!agent) return null;
  const tracked = resource?.resourceId
    ? repository.getAgentQuickAction(resource.resourceId)
    : null;
  if (tracked) {
    const labelOwner = repository.getAgentQuickActionByLabel(agent.id, label);
    if (labelOwner && labelOwner.id !== tracked.id) {
      throw new OperationalError(
        `Quick action label ${label} is already used by another action on ${agent.name}.`,
      );
    }
    return tracked;
  }
  return repository.getAgentQuickActionByLabel(agent.id, label);
}

function manifestResourceKeys(manifest: OperatorPackManifest) {
  return new Set([
    ...manifest.agents.map((agent) => `agent:${agent.key}`),
    ...manifest.agents.flatMap((agent) =>
      agent.quickActions.map(
        (action) => `quick_action:${agent.key}.${action.key}`,
      ),
    ),
    ...manifest.automations.map((automation) => `automation:${automation.key}`),
    ...manifest.docs.map((doc) => `doc:${doc.key}`),
  ]);
}

function resourceLabel(resource: OperatorPackResource) {
  const baselineLabel =
    resource.baseline.name ??
    resource.baseline.label ??
    resource.baseline.title;
  return typeof baselineLabel === "string"
    ? baselineLabel
    : resource.resourceKey;
}

async function currentPackResourceSnapshot(resource: OperatorPackResource) {
  if (!resource.resourceId) return undefined;
  if (resource.resourceType === "agent") {
    const agent = repository.getAgent(resource.resourceId);
    return agent ? agentSnapshot(agent) : undefined;
  }
  if (resource.resourceType === "quick_action") {
    const action = repository.getAgentQuickAction(resource.resourceId);
    return action ? actionSnapshot(action) : undefined;
  }
  if (resource.resourceType === "automation") {
    const automation = repository.getAutomation(resource.resourceId);
    return automation ? automationSnapshot(automation) : undefined;
  }
  try {
    return docSnapshot(await DocsClient.get(resource.resourceId));
  } catch {
    return undefined;
  }
}

async function resolvePackDoc(
  packId: string,
  resourceKey: string,
  resource?: OperatorPackResource,
) {
  if (resource?.resourceId) {
    try {
      return await DocsClient.get(resource.resourceId);
    } catch {
      // Fall through to the deterministic tag when the recorded Doc vanished.
    }
  }
  const [summary] = await DocsClient.list({
    tag: packResourceTag(packId, resourceKey),
    limit: 1,
    offset: 0,
  });
  return summary ? DocsClient.get(summary.id) : null;
}

function docSnapshot(doc: Awaited<ReturnType<typeof DocsClient.get>>) {
  return { title: doc.title, body: doc.body, tags: doc.tags };
}

export async function previewOperatorPack(
  packId: string,
): Promise<OperatorPackPreview> {
  const entry = getOperatorPackCatalogEntry(packId);
  if (!entry) throw new OperationalError("Operator Pack not found.");
  const { manifest, source } = entry;
  assertManifestRuntimeCompatibility(manifest);
  const installation = repository.getOperatorPackInstallation(packId);
  const resources = repository.listOperatorPackResources(packId);
  const changes: OperatorPackPreviewChange[] = [];

  for (const template of manifest.agents) {
    const resource = findResource(resources, "agent", template.key);
    const current = resolvePackAgent(template, resource);
    changes.push(
      previewChange({
        resourceType: "agent",
        resourceKey: template.key,
        label: template.name,
        proposed: {
          name: template.name,
          slug: template.slug,
          role: template.role,
          instructions: template.instructions,
          model: template.model,
          enabled: template.enabled,
          fullAccess: template.fullAccess,
        },
        current: current ? agentSnapshot(current) : undefined,
        resource,
      }),
    );

    for (const action of template.quickActions) {
      const actionResource = findResource(
        resources,
        "quick_action",
        `${template.key}.${action.key}`,
      );
      const currentAction = resolvePackQuickAction(
        current,
        action.label,
        actionResource,
      );
      changes.push(
        previewChange({
          resourceType: "quick_action",
          resourceKey: `${template.key}.${action.key}`,
          label: `${template.name} · ${action.label}`,
          proposed: { label: action.label, prompt: action.prompt },
          current: currentAction ? actionSnapshot(currentAction) : undefined,
          resource: actionResource,
        }),
      );
    }
  }

  for (const template of manifest.automations) {
    const resource = findResource(resources, "automation", template.key);
    const current = resource?.resourceId
      ? repository.getAutomation(resource.resourceId)
      : null;
    changes.push(
      previewChange({
        resourceType: "automation",
        resourceKey: template.key,
        label: template.name,
        proposed: {
          name: template.name,
          cronExpression: template.cronExpression,
          prompt: template.prompt,
          mode: template.mode,
          enabled: template.enabled,
        },
        current: current ? automationSnapshot(current) : undefined,
        resource,
      }),
    );
  }

  for (const template of manifest.docs) {
    const resourceKey = template.key;
    const resource = findResource(resources, "doc", resourceKey);
    const tag = packResourceTag(packId, resourceKey);
    let current: Awaited<ReturnType<typeof DocsClient.get>> | null = null;
    try {
      current = await resolvePackDoc(packId, resourceKey, resource);
    } catch {
      current = null;
    }
    changes.push(
      previewChange({
        resourceType: "doc",
        resourceKey,
        label: template.title,
        current: current ? docSnapshot(current) : undefined,
        proposed: {
          title: template.title,
          body: template.body,
          tags: [...new Set([...template.tags, tag])],
        },
        resource,
      }),
    );
  }

  const declaredKeys = manifestResourceKeys(manifest);
  for (const resource of resources) {
    const identity = `${resource.resourceType}:${resource.resourceKey}`;
    if (resource.state === "detached" || declaredKeys.has(identity)) continue;
    const current = await currentPackResourceSnapshot(resource);
    changes.push({
      resourceType: resource.resourceType,
      resourceKey: resource.resourceKey,
      label: resourceLabel(resource),
      action: "detach",
      baseline: resource.baseline,
      current,
      proposed: {
        effect:
          resource.resourceType === "automation" && resource.managed
            ? "Disable automation and detach pack ownership"
            : "Detach pack ownership without deleting product data",
      },
      userModified: Boolean(
        current &&
        !decidePackResourceChange({
          current,
          proposed: resource.baseline,
          resource,
        }).action.match(/^(unchanged|update)$/),
      ),
    });
  }

  return {
    pack: manifest,
    source,
    installation,
    changes,
    capabilities: capabilityStates(manifest),
    permissions: manifest.permissions,
    conflicts: changes.filter((change) => change.action === "conflict").length,
    remoteChanges: changes.filter(
      (change) => change.resourceType === "doc" && change.action === "create",
    ).length,
  };
}

function packResourceTag(packId: string, resourceKey: string) {
  const digest = createHash("sha256")
    .update(`${packId}:${resourceKey}`)
    .digest("hex")
    .slice(0, 40);
  return `operator-pack:${digest}`;
}

function applyLocalPackResources(
  preview: OperatorPackPreview,
  conflictStrategy: ConflictStrategy,
) {
  const { pack, source } = preview;
  const enabledRuntimeConfigs = runtimeIds
    .map((runtimeId) => getRuntimeConfig(runtimeId))
    .filter(({ enabled }) => enabled);
  const defaultRuntime =
    enabledRuntimeConfigs.find(
      ({ lastVerificationStatus }) => lastVerificationStatus === "connected",
    )?.runtimeId ??
    enabledRuntimeConfigs[0]?.runtimeId ??
    "codex";
  repository.saveOperatorPackInstallation({
    packId: pack.id,
    packVersion: pack.version,
    source,
    status: "installing",
    manifest: pack,
    lastError: null,
  });

  for (const change of preview.changes) {
    if (change.action !== "detach") continue;
    const resource = repository.getOperatorPackResource(
      pack.id,
      change.resourceType,
      change.resourceKey,
    );
    if (!resource) continue;
    if (
      resource.resourceType === "automation" &&
      resource.resourceId &&
      resource.managed
    ) {
      repository.updateAutomation(resource.resourceId, { enabled: false });
    }
    repository.saveOperatorPackResource({
      packId: pack.id,
      resourceType: resource.resourceType,
      resourceKey: resource.resourceKey,
      resourceId: resource.resourceId,
      managed: false,
      createdByPack: resource.createdByPack,
      reattachable: resource.managed || resource.reattachable,
      state: "detached",
      baseline: resource.baseline,
      lastError: null,
    });
  }

  const agentsByKey = new Map<string, Agent>();
  for (const template of pack.agents) {
    const change = preview.changes.find(
      (item) =>
        item.resourceType === "agent" && item.resourceKey === template.key,
    )!;
    const previousResource = repository.getOperatorPackResource(
      pack.id,
      "agent",
      template.key,
    );
    let agent = resolvePackAgent(template, previousResource ?? undefined);
    assertPreviewStillCurrent(change, agent ? agentSnapshot(agent) : undefined);
    let createdByPack = previousResource?.createdByPack ?? !agent;
    let managed = false;
    if (!agent) {
      agent = repository.createAgent({
        name: template.name,
        slug: template.slug,
        role: template.role,
        instructions: template.instructions,
        runtime: defaultRuntime,
        model: template.model,
        enabled: template.enabled,
        fullAccess: template.fullAccess,
      });
      createdByPack = true;
      managed = true;
    } else if (change.action === "update" || change.action === "unchanged") {
      agent = repository.updateAgent(agent.id, {
        name: template.name,
        slug: template.slug,
        role: template.role,
        instructions: template.instructions,
        model: template.model,
        enabled: template.enabled,
        fullAccess: template.fullAccess,
      })!;
      managed = true;
    } else if (change.action === "conflict" && conflictStrategy === "replace") {
      agent = repository.updateAgent(agent.id, {
        name: template.name,
        slug: template.slug,
        role: template.role,
        instructions: template.instructions,
        model: template.model,
        enabled: template.enabled,
        fullAccess: template.fullAccess,
      })!;
      managed = true;
    }
    agentsByKey.set(template.key, agent);
    repository.saveOperatorPackResource({
      packId: pack.id,
      resourceType: "agent",
      resourceKey: template.key,
      resourceId: agent.id,
      managed,
      createdByPack,
      reattachable: managed,
      state: "applied",
      baseline: managed
        ? agentSnapshot(agent)
        : (previousResource?.baseline ?? agentSnapshot(agent)),
    });

    for (const actionTemplate of template.quickActions) {
      const resourceKey = `${template.key}.${actionTemplate.key}`;
      const actionChange = preview.changes.find(
        (item) =>
          item.resourceType === "quick_action" &&
          item.resourceKey === resourceKey,
      )!;
      const previousActionResource = repository.getOperatorPackResource(
        pack.id,
        "quick_action",
        resourceKey,
      );
      let action = resolvePackQuickAction(
        agent,
        actionTemplate.label,
        previousActionResource ?? undefined,
      );
      assertPreviewStillCurrent(
        actionChange,
        action ? actionSnapshot(action) : undefined,
      );
      let actionCreatedByPack =
        previousActionResource?.createdByPack ?? !action;
      let actionManaged = false;
      if (!action) {
        action = repository.createAgentQuickAction(agent.id, actionTemplate);
        actionCreatedByPack = true;
        actionManaged = true;
      } else if (
        actionChange.action === "update" ||
        actionChange.action === "unchanged" ||
        (actionChange.action === "conflict" && conflictStrategy === "replace")
      ) {
        action = repository.updateAgentQuickAction(action.id, actionTemplate)!;
        actionManaged = true;
      }
      repository.saveOperatorPackResource({
        packId: pack.id,
        resourceType: "quick_action",
        resourceKey,
        resourceId: action.id,
        managed: actionManaged,
        createdByPack: actionCreatedByPack,
        reattachable: actionManaged,
        state: "applied",
        baseline: actionManaged
          ? actionSnapshot(action)
          : (previousActionResource?.baseline ?? actionSnapshot(action)),
      });
    }
  }

  for (const template of pack.automations) {
    const change = preview.changes.find(
      (item) =>
        item.resourceType === "automation" && item.resourceKey === template.key,
    )!;
    const previousResource = repository.getOperatorPackResource(
      pack.id,
      "automation",
      template.key,
    );
    let automation = previousResource?.resourceId
      ? repository.getAutomation(previousResource.resourceId)
      : null;
    assertPreviewStillCurrent(
      change,
      automation ? automationSnapshot(automation) : undefined,
    );
    let managed = false;
    let createdByPack = previousResource?.createdByPack ?? !automation;
    const agent = agentsByKey.get(template.agentKey)!;
    if (!automation) {
      automation = repository.createAutomation({
        name: template.name,
        agentId: agent.id,
        cronExpression: template.cronExpression,
        prompt: template.prompt,
        mode: template.mode,
        enabled: template.enabled,
      });
      createdByPack = true;
      managed = true;
    } else if (
      change.action === "update" ||
      change.action === "unchanged" ||
      (change.action === "conflict" && conflictStrategy === "replace")
    ) {
      automation = repository.updateAutomation(automation.id, {
        name: template.name,
        cronExpression: template.cronExpression,
        prompt: template.prompt,
        mode: template.mode,
        enabled: template.enabled,
      })!;
      managed = true;
    }
    repository.saveOperatorPackResource({
      packId: pack.id,
      resourceType: "automation",
      resourceKey: template.key,
      resourceId: automation.id,
      managed,
      createdByPack,
      reattachable: managed,
      state: "applied",
      baseline: managed
        ? automationSnapshot(automation)
        : (previousResource?.baseline ?? automationSnapshot(automation)),
    });
  }
}

async function applyDocResources(
  preview: OperatorPackPreview,
  conflictStrategy: ConflictStrategy,
) {
  const { pack } = preview;
  for (const template of pack.docs) {
    const tag = packResourceTag(pack.id, template.key);
    const previous = repository.getOperatorPackResource(
      pack.id,
      "doc",
      template.key,
    );
    const proposed = {
      title: template.title,
      body: template.body,
      tags: [...new Set([...template.tags, tag])],
    };
    const change = preview.changes.find(
      (item) =>
        item.resourceType === "doc" && item.resourceKey === template.key,
    )!;
    try {
      let found = await resolvePackDoc(
        pack.id,
        template.key,
        previous ?? undefined,
      );
      assertPreviewStillCurrent(change, found ? docSnapshot(found) : undefined);
      let managed = false;
      let createdByPack = previous?.createdByPack ?? !found;
      const action = found
        ? decidePackResourceChange({
            current: docSnapshot(found),
            proposed,
            resource: previous ?? undefined,
          }).action
        : "create";
      if (!found) {
        found = await DocsClient.create({
          ...proposed,
          author: "Slab Operator Pack",
        });
        managed = true;
        createdByPack = true;
      } else if (
        action === "update" ||
        action === "unchanged" ||
        (action === "conflict" && conflictStrategy === "replace")
      ) {
        found = await DocsClient.update(found.id, {
          ...proposed,
          author: "Slab Operator Pack",
        });
        managed = true;
      }
      repository.saveOperatorPackResource({
        packId: pack.id,
        resourceType: "doc",
        resourceKey: template.key,
        resourceId: found.id,
        managed,
        createdByPack,
        reattachable: managed,
        state: "applied",
        baseline: managed
          ? docSnapshot(found)
          : (previous?.baseline ?? docSnapshot(found)),
        lastError: null,
      });
    } catch (error) {
      repository.saveOperatorPackResource({
        packId: pack.id,
        resourceType: "doc",
        resourceKey: template.key,
        resourceId: previous?.resourceId ?? null,
        managed: previous?.managed ?? false,
        createdByPack: previous?.createdByPack ?? false,
        reattachable: previous?.reattachable ?? false,
        state: "failed",
        baseline: previous?.baseline ?? proposed,
        lastError:
          error instanceof Error
            ? error.message
            : "Could not reconcile starter Doc.",
      });
      throw error;
    }
  }
}

async function withPackInstallLock<T>(packId: string, task: () => Promise<T>) {
  const locks = packInstallState.operatorPackInstallLocks!;
  const previous = locks.get(packId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  locks.set(packId, current);
  try {
    return await current;
  } finally {
    if (locks.get(packId) === current) locks.delete(packId);
  }
}

export async function installOperatorPack(
  packId: string,
  conflictStrategy: ConflictStrategy = "preserve",
) {
  return withPackInstallLock(packId, async () => {
    const preview = await previewOperatorPack(packId);
    repository.transaction(() =>
      applyLocalPackResources(preview, conflictStrategy),
    );
    try {
      await applyDocResources(preview, conflictStrategy);
      return repository.saveOperatorPackInstallation({
        packId,
        packVersion: preview.pack.version,
        source: preview.source,
        status: "installed",
        manifest: preview.pack,
        lastError: null,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Pack installation was interrupted.";
      repository.saveOperatorPackInstallation({
        packId,
        packVersion: preview.pack.version,
        source: preview.source,
        status: "partial_failure",
        manifest: preview.pack,
        lastError: message,
      });
      throw new OperationalError(
        `Local resources were installed, but a remote resource failed: ${message}. Retry the installation to resume.`,
      );
    }
  });
}

export function disableOperatorPack(packId: string) {
  return withPackInstallLock(packId, async () => {
    const installation = repository.getOperatorPackInstallation(packId);
    if (!installation) throw new OperationalError("Operator Pack is not installed.");
    return repository.transaction(() => {
      for (const resource of repository.listOperatorPackResources(packId)) {
        if (
          resource.resourceType === "automation" &&
          resource.resourceId &&
          resource.managed
        ) {
          repository.updateAutomation(resource.resourceId, { enabled: false });
        }
      }
      repository.detachOperatorPackResources(packId);
      return repository.saveOperatorPackInstallation({
        packId,
        packVersion: installation.packVersion,
        source: installation.source,
        status: "disabled",
        manifest: installation.manifest,
        lastError: null,
        disabledAt: new Date().toISOString(),
      });
    });
  });
}

export function importOperatorPack(input: unknown) {
  const manifest = parseOperatorPackManifest(input);
  if (getOfficialOperatorPack(manifest.id)) {
    throw new OperationalError("Official Operator Pack IDs cannot be replaced.");
  }
  assertManifestRuntimeCompatibility(manifest);
  const existing = repository.getOperatorPackDefinition(manifest.id);
  if (
    existing &&
    comparePackVersions(manifest.version, existing.version) <= 0
  ) {
    throw new OperationalError(
      "Imported pack version must be newer than the local version.",
    );
  }
  return repository.saveOperatorPackDefinition(manifest);
}

export function removeLocalOperatorPackDefinition(packId: string) {
  return withPackInstallLock(packId, async () => {
    if (getOfficialOperatorPack(packId)) {
      throw new OperationalError("Official Operator Packs cannot be deleted.");
    }
    const installation = repository.getOperatorPackInstallation(packId);
    if (installation && installation.status !== "disabled") {
      throw new OperationalError(
        "Disable the installed pack before deleting its definition.",
      );
    }
    return repository.deleteOperatorPackDefinition(packId);
  });
}

function latestAcceptance(packId: string, packVersion?: string) {
  return (
    repository
      .listOperatorPackAcceptances(packId)
      .find(
        (acceptance) => !packVersion || acceptance.packVersion === packVersion,
      ) ?? null
  );
}

export async function getOperatorPackSummaries(): Promise<
  OperatorPackSummary[]
> {
  const summaries: OperatorPackSummary[] = [];
  for (const entry of listOperatorPackCatalog()) {
    const installation = repository.getOperatorPackInstallation(
      entry.manifest.id,
    );
    let acceptance = latestAcceptance(
      entry.manifest.id,
      installation?.packVersion,
    );
    if (acceptance) {
      acceptance =
        (await refreshOperatorPackAcceptance(acceptance.id)) ?? acceptance;
    }
    const capabilities = capabilityStates(entry.manifest);
    summaries.push({
      manifest: entry.manifest,
      source: entry.source,
      installation,
      capabilities,
      configured: capabilities.every(
        (capability) => !capability.required || capability.available,
      ),
      updateAvailable: Boolean(
        installation &&
        comparePackVersions(entry.manifest.version, installation.packVersion) >
          0,
      ),
      acceptance,
    });
  }
  return summaries;
}

function acceptanceTag(acceptanceId: string) {
  return `operator-pack-acceptance:${acceptanceId}`;
}

async function createAcceptanceFixtures(
  pack: OperatorPackManifest,
  scenario: OperatorPackAcceptanceScenario,
  acceptance: OperatorPackAcceptance,
  agent: Agent,
) {
  let projects = await WorkClient.listProjects();
  let project: Project | undefined = projects[0];
  if (!project) {
    try {
      project = await WorkClient.createProject({
        key: "QA",
        name: "Operator Pack Acceptance",
        description:
          "Synthetic Work fixtures created by Slab Agents acceptance QA.",
      });
    } catch (error) {
      // Another acceptance may have created the project after our initial read.
      projects = await WorkClient.listProjects();
      project = projects.find((candidate) => candidate.key === "QA");
      if (!project) throw error;
    }
  }
  const tag = acceptanceTag(acceptance.id);
  const doc =
    scenario.fixture.docTitle && scenario.fixture.docBody
      ? await DocsClient.create({
          title: `${scenario.fixture.docTitle} · ${acceptance.id.slice(0, 8)}`,
          body: scenario.fixture.docBody,
          tags: ["synthetic", "operator-pack-acceptance", tag],
          author: "Slab Acceptance QA",
        })
      : null;
  repository.updateOperatorPackAcceptance(acceptance.id, {
    projectKey: project.key,
    docId: doc?.id ?? null,
  });
  const issue = await WorkClient.createIssue({
    project_key: project.key,
    title: `${scenario.fixture.issueTitle} · ${acceptance.id.slice(0, 8)}`,
    description: [
      scenario.fixture.issueDescription,
      ...(doc ? ["", `Synthetic fixture Doc: ${doc.title}`] : []),
      `Acceptance marker: ${tag}`,
    ].join("\n"),
    type: "task",
    priority: scenario.fixture.priority,
    labels: ["synthetic", "operator-pack-acceptance", `pack:${pack.id}`],
    ...(scenario.execution === "assignment" ? { assignee: agent.slug } : {}),
  });
  return { project, doc, issue };
}

export async function startOperatorPackAcceptance(
  packId: string,
  scenarioId?: string,
) {
  const entry = getOperatorPackCatalogEntry(packId);
  const installation = repository.getOperatorPackInstallation(packId);
  if (!entry || !installation || installation.status !== "installed") {
    throw new OperationalError("Install the Operator Pack before running acceptance QA.");
  }
  if (installation.packVersion !== entry.manifest.version) {
    throw new OperationalError(
      "Apply the available Operator Pack update before running acceptance QA.",
    );
  }
  const capabilities = capabilityStates(entry.manifest);
  const missing = capabilities.filter(
    (capability) => capability.required && !capability.available,
  );
  if (missing.length) {
    throw new OperationalError(
      `Connect required capabilities first: ${missing
        .map((capability) => capability.category)
        .join(", ")}.`,
    );
  }
  const scenario = scenarioId
    ? entry.manifest.acceptanceScenarios.find((item) => item.id === scenarioId)
    : entry.manifest.acceptanceScenarios[0];
  if (!scenario) throw new OperationalError("Acceptance scenario not found.");
  const agentTemplate = entry.manifest.agents.find(
    (item) => item.key === scenario.agentKey,
  )!;
  const agentResource = repository.getOperatorPackResource(
    packId,
    "agent",
    agentTemplate.key,
  );
  const agent = resolvePackAgent(agentTemplate, agentResource ?? undefined);
  if (!agent || !agent.enabled) {
    throw new OperationalError("The pack Agent is missing or disabled.");
  }
  const acceptance = repository.createOperatorPackAcceptance({
    packId,
    scenarioId: scenario.id,
    packVersion: installation.packVersion,
    rubric: scenario.rubric,
  });
  try {
    const fixture = await createAcceptanceFixtures(
      entry.manifest,
      scenario,
      acceptance,
      agent,
    );
    repository.updateOperatorPackAcceptance(acceptance.id, {
      issueKey: fixture.issue.key,
    });
    let run;
    if (scenario.execution === "review") {
      const thread = repository.createThread(
        agent.id,
        `${entry.manifest.name} acceptance · ${fixture.issue.key}`,
      );
      run = createRunExecution({
        agentId: agent.id,
        threadId: thread.id,
        trigger: "manual",
        mode: "review",
        prompt: [
          scenario.prompt,
          `Synthetic Work item: ${fixture.issue.key}`,
          ...(fixture.doc ? [`Synthetic Doc title: ${fixture.doc.title}`] : []),
          "Use only these synthetic fixtures for this acceptance scenario.",
        ].join("\n"),
      });
      void executeRunInBackground(run.id);
    } else {
      const findAssignmentRun = () =>
        repository
          .listRuns()
          .find(
            (candidate) =>
              candidate.agentId === agent.id &&
              candidate.issueKey === fixture.issue.key &&
              candidate.trigger === "assignment",
          );
      run = await findAcceptanceAssignmentRun({
        tick: tickWorkCoordination,
        find: findAssignmentRun,
      });
      if (!run) {
        throw new OperationalError("Work assignment did not create an Agent Run.");
      }
    }
    return repository.updateOperatorPackAcceptance(acceptance.id, {
      runId: run.id,
      status: run.status === "queued" ? "queued" : "running",
      error: null,
    })!;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Acceptance setup failed.";
    repository.updateOperatorPackAcceptance(acceptance.id, {
      status: "failed",
      error: message,
      completedAt: new Date().toISOString(),
    });
    throw error;
  }
}

function acceptanceToolEvidence(
  events: ReturnType<typeof repository.listRunEvents>,
) {
  return events
    .filter((event) => event.type === "tool_completed")
    .map((event) => {
      const payload = event.payload as Record<string, unknown>;
      return {
        name: String(payload.name ?? ""),
        success: payload.success === true,
        arguments:
          payload.debugArgumentsPayload ?? payload.argumentsPreview ?? null,
        response: {
          payload:
            payload.debugResponsePayload ?? payload.responsePreview ?? null,
          searchResults: payload.searchResults ?? null,
        },
      };
    });
}

export async function refreshOperatorPackAcceptance(id: string) {
  const acceptance = repository.getOperatorPackAcceptance(id);
  if (!acceptance || !acceptance.runId) return acceptance;
  if (acceptance.status === "passed" || acceptance.status === "failed") {
    return acceptance;
  }
  const run = repository.getRun(acceptance.runId);
  if (!run) {
    return repository.updateOperatorPackAcceptance(id, {
      status: "failed",
      error: "Acceptance Run no longer exists.",
      completedAt: new Date().toISOString(),
    })!;
  }
  if (["queued", "running", "waiting_approval"].includes(run.status)) {
    return repository.updateOperatorPackAcceptance(id, {
      status: run.status === "queued" ? "queued" : "running",
      error: null,
    })!;
  }
  if (run.status !== "completed") {
    return repository.updateOperatorPackAcceptance(id, {
      status: "failed",
      evidence: { runStatus: run.status },
      error: `Acceptance Run ended with status ${run.status}.`,
      completedAt: new Date().toISOString(),
    })!;
  }
  repository.updateOperatorPackAcceptance(id, { status: "evaluating" });
  try {
    const events = repository.listRunEvents(run.id);
    const tools = acceptanceToolEvidence(events);
    const issue = acceptance.issueKey
      ? await WorkClient.getIssue(acceptance.issueKey)
      : null;
    const comments = acceptance.issueKey
      ? await WorkClient.listComments(acceptance.issueKey)
      : [];
    const rubric = acceptance.rubric as {
      requiresWorkRead: boolean;
      requiresDocsRead: boolean;
      requiresWorkWrite: boolean;
      expectedIssueStatus: string;
      maxCreatedWorkItems: number;
    };
    const evaluation = evaluateOperatorPackAcceptance({
      rubric,
      tools,
      issueKey: acceptance.issueKey ?? "",
      docReferences: [acceptance.docId ?? "", acceptanceTag(acceptance.id)],
      issueStatus: issue?.status ?? null,
      commentCount: comments.length,
    });
    const evidence = {
      checks: evaluation.checks,
      runStatus: run.status,
      issueStatus: issue?.status ?? null,
      commentCount: comments.length,
      completedToolCount: tools.length,
      createdWorkItems: evaluation.createdWorkItems,
    };
    return repository.updateOperatorPackAcceptance(id, {
      status: evaluation.passed ? "passed" : "failed",
      evidence,
      error: evaluation.passed
        ? null
        : "One or more deterministic rubric checks failed.",
      completedAt: new Date().toISOString(),
    })!;
  } catch (error) {
    return repository.updateOperatorPackAcceptance(id, {
      status: "evaluating",
      error:
        error instanceof Error
          ? `Evaluation will retry: ${error.message}`
          : "Evaluation will retry when Work is available.",
    })!;
  }
}

export function operatorPackMetrics(): OperatorPackMetrics {
  const installedVersions = new Map(
    repository
      .listOperatorPackInstallations()
      .map((installation) => [installation.packId, installation.packVersion]),
  );
  const acceptances = repository
    .listOperatorPackAcceptances()
    .filter(
      (acceptance) =>
        installedVersions.get(acceptance.packId) === acceptance.packVersion,
    );
  const passed = acceptances.filter((item) => item.status === "passed").length;
  const failed = acceptances.filter((item) => item.status === "failed").length;
  const running = acceptances.filter((item) =>
    ["preparing", "queued", "running", "evaluating"].includes(item.status),
  ).length;
  const terminal = passed + failed;
  const firstAcceptedMinutes = repository
    .listOperatorPackInstallations()
    .flatMap((installation) => {
      const accepted = acceptances
        .filter(
          (item) =>
            item.packId === installation.packId &&
            item.status === "passed" &&
            item.completedAt,
        )
        .sort((left, right) =>
          String(left.completedAt).localeCompare(String(right.completedAt)),
        )[0];
      if (!accepted?.completedAt) return [];
      const elapsed =
        Date.parse(accepted.completedAt) - Date.parse(installation.installedAt);
      return elapsed >= 0 ? [elapsed / 60_000] : [];
    })
    .sort((left, right) => left - right);
  const middle = Math.floor(firstAcceptedMinutes.length / 2);
  const medianMinutesToAcceptedOutcome = firstAcceptedMinutes.length
    ? firstAcceptedMinutes.length % 2
      ? firstAcceptedMinutes[middle]
      : (firstAcceptedMinutes[middle - 1] + firstAcceptedMinutes[middle]) / 2
    : null;
  return {
    total: acceptances.length,
    passed,
    failed,
    running,
    passRate: terminal ? passed / terminal : null,
    medianMinutesToAcceptedOutcome,
  };
}

export function exportOperatorPack(packId: string) {
  const entry = getOperatorPackCatalogEntry(packId);
  if (!entry) throw new OperationalError("Operator Pack not found.");
  return entry.manifest;
}
