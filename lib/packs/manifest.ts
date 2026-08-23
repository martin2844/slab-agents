import { z } from "zod";

const identifier = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);
const slug = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
const semver = z.string().regex(/^\d+\.\d+\.\d+$/);

export const packCapabilityCategorySchema = z.enum([
  "work",
  "docs",
  "email",
  "calendar",
  "crm",
  "metrics",
  "product_analytics",
  "error_monitoring",
  "github",
]);

const quickActionSchema = z
  .object({
    key: identifier,
    label: z.string().min(2).max(80),
    prompt: z.string().min(10).max(20_000),
  })
  .strict();

const agentTemplateSchema = z
  .object({
    key: identifier,
    name: z.string().min(2).max(80),
    slug,
    role: z.string().min(2).max(120),
    instructions: z.string().min(10).max(20_000),
    model: z.string().min(1).max(120).default("default"),
    enabled: z.boolean().default(true),
    fullAccess: z.boolean().default(false),
    quickActions: z.array(quickActionSchema).max(12).default([]),
  })
  .strict();

const automationTemplateSchema = z
  .object({
    key: identifier,
    agentKey: identifier,
    name: z.string().min(2).max(100),
    mode: z.enum(["review", "task"]),
    cronExpression: z.string().min(5).max(120).nullable(),
    prompt: z.string().min(10).max(50_000),
    enabled: z.boolean().default(false),
  })
  .strict();

const capabilityRequirementSchema = z
  .object({
    category: packCapabilityCategorySchema,
    required: z.boolean(),
    description: z.string().min(2).max(240),
  })
  .strict();

const permissionRecommendationSchema = z
  .object({
    capability: packCapabilityCategorySchema,
    action: z.string().min(2).max(100),
    policy: z.enum(["disabled", "approval_required", "autonomous"]),
    reason: z.string().min(2).max(240),
  })
  .strict();

const docTemplateSchema = z
  .object({
    key: identifier,
    title: z.string().min(2).max(200),
    body: z.string().min(10).max(50_000),
    tags: z.array(z.string().min(1).max(64)).max(20).default([]),
  })
  .strict();

const acceptanceScenarioSchema = z
  .object({
    id: identifier,
    title: z.string().min(2).max(120),
    description: z.string().min(10).max(500),
    agentKey: identifier,
    execution: z.enum(["review", "assignment"]),
    fixture: z
      .object({
        docTitle: z.string().min(2).max(180).optional(),
        docBody: z.string().min(10).max(20_000).optional(),
        issueTitle: z.string().min(2).max(500),
        issueDescription: z.string().min(10).max(10_000),
        priority: z.enum(["critical", "high", "medium", "low"]),
      })
      .strict(),
    prompt: z.string().min(10).max(20_000),
    rubric: z
      .object({
        requiresWorkRead: z.boolean(),
        requiresDocsRead: z.boolean(),
        requiresWorkWrite: z.boolean(),
        expectedIssueStatus: z.enum([
          "new",
          "in_progress",
          "blocked",
          "review",
          "done",
        ]),
        maxCreatedWorkItems: z.number().int().min(0).max(10),
      })
      .strict(),
  })
  .strict();

export const operatorPackManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: identifier,
    version: semver,
    name: z.string().min(2).max(100),
    author: z.string().min(2).max(100),
    description: z.string().min(10).max(500),
    outcome: z.string().min(10).max(500),
    compatibility: z
      .object({
        minimumSlabVersion: semver,
      })
      .strict(),
    agents: z.array(agentTemplateSchema).min(1).max(8),
    automations: z.array(automationTemplateSchema).max(12).default([]),
    capabilities: z.array(capabilityRequirementSchema).min(1).max(20),
    permissions: z.array(permissionRecommendationSchema).max(20).default([]),
    workConventions: z.array(z.string().min(2).max(240)).max(20).default([]),
    docs: z.array(docTemplateSchema).max(20).default([]),
    acceptanceScenarios: z.array(acceptanceScenarioSchema).min(1).max(8),
    upgradeNotes: z.array(z.string().min(2).max(500)).max(20).default([]),
  })
  .strict()
  .superRefine((manifest, context) => {
    const agentKeys = new Set<string>();
    const agentSlugs = new Set<string>();
    const automationKeys = new Set<string>();
    const docKeys = new Set<string>();
    const scenarioIds = new Set<string>();
    const capabilityCategories = new Set<string>();
    for (const agent of manifest.agents) {
      if (agentKeys.has(agent.key)) {
        context.addIssue({
          code: "custom",
          path: ["agents"],
          message: `Duplicate agent key: ${agent.key}`,
        });
      }
      if (agentSlugs.has(agent.slug)) {
        context.addIssue({
          code: "custom",
          path: ["agents"],
          message: `Duplicate agent slug: ${agent.slug}`,
        });
      }
      if (agent.fullAccess) {
        context.addIssue({
          code: "custom",
          path: ["agents", agent.key, "fullAccess"],
          message:
            "Operator Packs cannot grant full access. Configure elevated access explicitly after installation.",
        });
      }
      agentKeys.add(agent.key);
      agentSlugs.add(agent.slug);
      const actionKeys = new Set<string>();
      const actionLabels = new Set<string>();
      for (const action of agent.quickActions) {
        if (actionKeys.has(action.key)) {
          context.addIssue({
            code: "custom",
            path: ["agents", agent.key, "quickActions"],
            message: `Duplicate quick action key: ${action.key}`,
          });
        }
        if (actionLabels.has(action.label)) {
          context.addIssue({
            code: "custom",
            path: ["agents", agent.key, "quickActions"],
            message: `Duplicate quick action label: ${action.label}`,
          });
        }
        actionKeys.add(action.key);
        actionLabels.add(action.label);
      }
    }
    const permissionKeys = new Set<string>();
    for (const permission of manifest.permissions) {
      const key = `${permission.capability}:${permission.action}`;
      if (permissionKeys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["permissions"],
          message: `Duplicate permission recommendation: ${key}`,
        });
      }
      permissionKeys.add(key);
    }
    for (const automation of manifest.automations) {
      if (automationKeys.has(automation.key)) {
        context.addIssue({
          code: "custom",
          path: ["automations", automation.key],
          message: `Duplicate automation key: ${automation.key}`,
        });
      }
      automationKeys.add(automation.key);
      if (!agentKeys.has(automation.agentKey)) {
        context.addIssue({
          code: "custom",
          path: ["automations", automation.key, "agentKey"],
          message: `Unknown agent key: ${automation.agentKey}`,
        });
      }
    }
    for (const capability of manifest.capabilities) {
      if (capabilityCategories.has(capability.category)) {
        context.addIssue({
          code: "custom",
          path: ["capabilities", capability.category],
          message: `Duplicate capability category: ${capability.category}`,
        });
      }
      capabilityCategories.add(capability.category);
    }
    for (const doc of manifest.docs) {
      if (docKeys.has(doc.key)) {
        context.addIssue({
          code: "custom",
          path: ["docs", doc.key],
          message: `Duplicate Doc key: ${doc.key}`,
        });
      }
      docKeys.add(doc.key);
    }
    for (const scenario of manifest.acceptanceScenarios) {
      if (scenarioIds.has(scenario.id)) {
        context.addIssue({
          code: "custom",
          path: ["acceptanceScenarios", scenario.id],
          message: `Duplicate acceptance scenario ID: ${scenario.id}`,
        });
      }
      scenarioIds.add(scenario.id);
      if (!agentKeys.has(scenario.agentKey)) {
        context.addIssue({
          code: "custom",
          path: ["acceptanceScenarios", scenario.id, "agentKey"],
          message: `Unknown agent key: ${scenario.agentKey}`,
        });
      }
      const hasDocTitle = scenario.fixture.docTitle !== undefined;
      const hasDocBody = scenario.fixture.docBody !== undefined;
      if (hasDocTitle !== hasDocBody) {
        context.addIssue({
          code: "custom",
          path: ["acceptanceScenarios", scenario.id, "fixture"],
          message: "Acceptance Doc title and body must be provided together.",
        });
      }
      if (scenario.rubric.requiresDocsRead && !hasDocTitle) {
        context.addIssue({
          code: "custom",
          path: ["acceptanceScenarios", scenario.id, "fixture"],
          message:
            "A Doc fixture is required when the rubric requires a Docs read.",
        });
      }
    }
    const workCapability = manifest.capabilities.find(
      (capability) => capability.category === "work",
    );
    if (!workCapability?.required) {
      context.addIssue({
        code: "custom",
        path: ["capabilities"],
        message:
          "Work must be declared as required because acceptance uses a synthetic Work item.",
      });
    }
    const hasDocFixture = manifest.acceptanceScenarios.some(
      (scenario) => scenario.fixture.docTitle !== undefined,
    );
    const docsCapability = manifest.capabilities.find(
      (capability) => capability.category === "docs",
    );
    if (hasDocFixture && !docsCapability?.required) {
      context.addIssue({
        code: "custom",
        path: ["capabilities"],
        message:
          "Docs must be declared as required when acceptance includes a Doc fixture.",
      });
    }
  });

export type PackCapabilityCategory = z.infer<
  typeof packCapabilityCategorySchema
>;
export type OperatorPackManifest = z.infer<typeof operatorPackManifestSchema>;
export type OperatorPackAgentTemplate = OperatorPackManifest["agents"][number];
export type OperatorPackAcceptanceScenario =
  OperatorPackManifest["acceptanceScenarios"][number];

export function parseOperatorPackManifest(input: unknown) {
  return operatorPackManifestSchema.parse(input);
}
