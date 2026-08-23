import {
  parseOperatorPackManifest,
  type OperatorPackManifest,
} from "@/lib/packs/manifest";

const founderOps = {
  schemaVersion: 1,
  id: "founder-ops",
  version: "1.0.0",
  name: "Founder Ops",
  author: "Slab",
  description:
    "A compact operating loop for reviewing company state and creating only material follow-up work.",
  outcome:
    "Receive an evidence-based operating review with a short list of justified priorities.",
  compatibility: { minimumSlabVersion: "0.1.0" },
  agents: [
    {
      key: "coo",
      name: "COO",
      slug: "coo",
      role: "Chief Operating Officer",
      instructions: [
        "Own the operating cadence of the company.",
        "Use Work as the source of truth for current commitments and Docs for durable company context.",
        "Prioritize a small number of material actions, identify owners and blockers, and avoid creating filler work.",
        "Separate evidence from inference, keep decisions auditable, and prefer updating existing Work over creating duplicates.",
      ].join("\n"),
      model: "default",
      enabled: true,
      fullAccess: false,
      quickActions: [
        {
          key: "daily-review",
          label: "Daily operating review",
          prompt:
            "Review current Work and relevant Docs. Identify at most three material priorities, the evidence for each, owners, and blockers. Update or create Work only when an actionable gap is not already represented.",
        },
        {
          key: "weekly-plan",
          label: "Weekly planning",
          prompt:
            "Review the previous week, open commitments, and current company goals. Propose a focused weekly plan with explicit owners and explain which existing Work should change.",
        },
      ],
    },
  ],
  automations: [
    {
      key: "weekday-review",
      agentKey: "coo",
      name: "Founder Ops weekday review",
      mode: "review",
      cronExpression: "0 8 * * 1-5",
      prompt:
        "Perform the daily operating review. Review current Work before creating anything, surface only material priorities, and leave no changes when the current plan is already sufficient.",
      enabled: false,
    },
  ],
  capabilities: [
    {
      category: "work",
      required: true,
      description: "Current commitments, owners, status, and durable outcomes.",
    },
    {
      category: "docs",
      required: true,
      description:
        "Company strategy, policies, decisions, and operating context.",
    },
    {
      category: "calendar",
      required: false,
      description: "Upcoming commitments and planning constraints.",
    },
    {
      category: "metrics",
      required: false,
      description: "Curated business and operational metrics.",
    },
  ],
  permissions: [
    {
      capability: "calendar",
      action: "Create, update, or cancel events",
      policy: "approval_required",
      reason: "Calendar writes affect people outside the control plane.",
    },
  ],
  workConventions: [
    "Review existing Work before creating new items.",
    "Create no more than a few material priorities per review.",
  ],
  docs: [
    {
      key: "operating-review-guide",
      title: "Founder Ops · Operating review guide",
      body: [
        "# Operating review guide",
        "",
        "Use this review to identify the smallest set of material actions that changes company outcomes.",
        "",
        "- Review existing Work before proposing new Work.",
        "- Separate observed evidence from inference.",
        "- Record owners, blockers, and the next verifiable outcome.",
        "- It is valid to make no changes when the current plan is sufficient.",
      ].join("\n"),
      tags: ["operator-pack", "founder-ops", "operating-review"],
    },
  ],
  acceptanceScenarios: [
    {
      id: "operating-review",
      title: "Review a synthetic operating signal",
      description:
        "Reviews a fictional launch risk, consults its context, and records a bounded decision in Work.",
      agentKey: "coo",
      execution: "review",
      fixture: {
        docTitle: "Synthetic launch context",
        docBody:
          "The fictional Atlas launch is scheduled for Friday. The only material risk is that owner confirmation for the migration checklist is still missing. Budget and staffing are already approved.",
        issueTitle: "Synthetic: decide the next action for Atlas launch",
        issueDescription:
          "Review the synthetic launch context, identify the single material next action, record the decision here, and complete this analysis item.",
        priority: "high",
      },
      prompt:
        "Run the Founder Ops acceptance review. Read the synthetic Work item and the synthetic launch Doc, record one concise evidence-based decision as a Work comment, avoid unrelated Work creation, and mark the analysis item done when the deliverable is complete.",
      rubric: {
        requiresWorkRead: true,
        requiresDocsRead: true,
        requiresWorkWrite: true,
        expectedIssueStatus: "done",
        maxCreatedWorkItems: 0,
      },
    },
  ],
  upgradeNotes: [],
} satisfies OperatorPackManifest;

const salesOps = {
  schemaVersion: 1,
  id: "sales-ops",
  version: "1.0.0",
  name: "Sales Ops",
  author: "Slab",
  description:
    "An assignment-focused commercial operator that grounds opportunity work in customer context and records the result in Work.",
  outcome:
    "Advance assigned commercial Work with evidence and close the current deliverable using the correct semantic status.",
  compatibility: { minimumSlabVersion: "0.1.0" },
  agents: [
    {
      key: "sales",
      name: "Sales",
      slug: "sales",
      role: "Sales operator",
      instructions: [
        "Advance assigned commercial Work using verifiable customer and product context.",
        "Use Work for the requested deliverable and Docs for approved positioning, policies, and product facts.",
        "Document evidence, conclusions, and recommended next actions without inventing customer details.",
        "Evaluate completion against the current Work deliverable rather than every downstream sales action.",
      ].join("\n"),
      model: "default",
      enabled: true,
      fullAccess: false,
      quickActions: [
        {
          key: "analyze-opportunity",
          label: "Analyze opportunity",
          prompt:
            "Analyze the opportunity described in the current task using available Work, Docs, CRM, and product metrics. Record the evidence, qualification, and recommended next action.",
        },
        {
          key: "draft-follow-up",
          label: "Draft customer follow-up",
          prompt:
            "Prepare a grounded follow-up draft for the current commercial task. Use approved product context and do not send it without the configured approval.",
        },
      ],
    },
  ],
  automations: [],
  capabilities: [
    {
      category: "work",
      required: true,
      description: "Assigned commercial deliverables and durable outcomes.",
    },
    {
      category: "docs",
      required: true,
      description: "Approved product, pricing, and positioning context.",
    },
    {
      category: "email",
      required: false,
      description: "Customer threads and approved drafting or sending.",
    },
    {
      category: "calendar",
      required: false,
      description: "Availability and scheduled customer commitments.",
    },
    {
      category: "crm",
      required: false,
      description: "Account, opportunity, and contact context.",
    },
    {
      category: "metrics",
      required: false,
      description: "Product usage and commercial signals.",
    },
  ],
  permissions: [
    {
      capability: "email",
      action: "Send or reply to email",
      policy: "approval_required",
      reason:
        "Outbound customer communication requires human approval by default.",
    },
    {
      capability: "calendar",
      action: "Create, update, or cancel events",
      policy: "approval_required",
      reason: "Customer-facing calendar changes require approval by default.",
    },
  ],
  workConventions: [
    "Use done when the requested analysis or draft is complete, even when a later action remains.",
    "Use review only when the current deliverable explicitly requires acceptance or approval.",
  ],
  docs: [
    {
      key: "qualification-guide",
      title: "Sales Ops · Opportunity qualification guide",
      body: [
        "# Opportunity qualification guide",
        "",
        "Record the observed signal, supporting evidence, confidence, and recommended next action.",
        "Close an analysis deliverable when that analysis is sufficient; a later outreach step is separate work.",
      ].join("\n"),
      tags: ["operator-pack", "sales-ops", "qualification"],
    },
  ],
  acceptanceScenarios: [
    {
      id: "qualify-opportunity",
      title: "Qualify a synthetic product-led opportunity",
      description:
        "Analyzes fictional usage evidence and completes the analysis without treating future outreach as review work.",
      agentKey: "sales",
      execution: "assignment",
      fixture: {
        docTitle: "Synthetic API plan notes",
        docBody:
          "Free API workspaces include 200 monthly requests. Repeatedly reaching the limit in the first week is a strong expansion signal. Analysis may recommend outreach, but outreach is a separate deliverable.",
        issueTitle: "Synthetic: analyze account expansion potential",
        issueDescription:
          "A fictional customer reached all 200 free API requests in two days for three consecutive months. Analyze expansion potential, record evidence and a recommendation, and complete this analysis item. Do not contact anyone.",
        priority: "high",
      },
      prompt:
        "Read the assigned synthetic Work item and relevant synthetic Doc. Record the qualification evidence and recommended next action in Work. The requested deliverable is analysis, not outreach; mark it done when the analysis is sufficient.",
      rubric: {
        requiresWorkRead: true,
        requiresDocsRead: true,
        requiresWorkWrite: true,
        expectedIssueStatus: "done",
        maxCreatedWorkItems: 0,
      },
    },
  ],
  upgradeNotes: [],
} satisfies OperatorPackManifest;

const engineeringOps = {
  schemaVersion: 1,
  id: "engineering-ops",
  version: "1.0.0",
  name: "Engineering Ops",
  author: "Slab",
  description:
    "A bounded engineering operator for turning repository, product, and incident evidence into actionable Work.",
  outcome:
    "Produce a verified diagnosis or bounded implementation plan and persist it in the assigned engineering Work item.",
  compatibility: { minimumSlabVersion: "0.1.0" },
  agents: [
    {
      key: "engineering-lead",
      name: "Engineering Lead",
      slug: "engineering-lead",
      role: "Engineering lead",
      instructions: [
        "Turn product, repository, and operational evidence into bounded engineering outcomes.",
        "Investigate before proposing a fix, distinguish root cause from symptoms, and keep the current Work deliverable explicit.",
        "Use Docs for architecture and operational context and record the verified conclusion or plan in Work.",
        "Do not claim code or deployment verification that did not occur.",
      ].join("\n"),
      model: "default",
      enabled: true,
      fullAccess: false,
      quickActions: [
        {
          key: "triage-bug",
          label: "Triage bug",
          prompt:
            "Investigate the reported behavior, separate confirmed evidence from hypotheses, identify the likely root cause, and record the minimum verified next step in Work.",
        },
        {
          key: "review-release",
          label: "Review release",
          prompt:
            "Review the release evidence, open engineering Work, and known risks. Record blocking findings and a concise readiness recommendation.",
        },
      ],
    },
  ],
  automations: [],
  capabilities: [
    {
      category: "work",
      required: true,
      description: "Engineering deliverables, status, ownership, and outcomes.",
    },
    {
      category: "docs",
      required: true,
      description: "Architecture, runbooks, decisions, and product context.",
    },
    {
      category: "github",
      required: false,
      description:
        "Repository, pull request, issue, and CI evidence when connected.",
    },
    {
      category: "error_monitoring",
      required: false,
      description: "Production error evidence such as Sentry.",
    },
    {
      category: "product_analytics",
      required: false,
      description: "Behavioral evidence such as PostHog.",
    },
  ],
  permissions: [
    {
      capability: "github",
      action: "Modify repositories, issues, or pull requests",
      policy: "approval_required",
      reason: "Repository writes follow the runtime approval boundary.",
    },
  ],
  workConventions: [
    "Record confirmed evidence separately from hypotheses.",
    "A diagnosis task is done when the diagnosis and bounded next step are verifiable; implementation is separate unless requested.",
  ],
  docs: [
    {
      key: "triage-guide",
      title: "Engineering Ops · Triage guide",
      body: [
        "# Engineering triage guide",
        "",
        "Reproduce or establish observable evidence before recommending a fix.",
        "Record impact, evidence, likely root cause, uncertainty, and the smallest next verification step.",
      ].join("\n"),
      tags: ["operator-pack", "engineering-ops", "triage"],
    },
  ],
  acceptanceScenarios: [
    {
      id: "triage-incident",
      title: "Triage a synthetic timeout regression",
      description:
        "Uses fictional runbook evidence to produce a bounded diagnosis without inventing code-level verification.",
      agentKey: "engineering-lead",
      execution: "assignment",
      fixture: {
        docTitle: "Synthetic connector timeout runbook",
        docBody:
          "Connector requests have a 15 second control-plane timeout. A response that consistently arrives after 20 seconds should be diagnosed as an upstream latency regression. The triage deliverable is a verified diagnosis and bounded next step, not a deployed fix.",
        issueTitle: "Synthetic: triage connector timeout regression",
        issueDescription:
          "A fictional connector now responds in 21 seconds and every call reaches the 15 second timeout. Use the synthetic runbook, record the likely root cause and smallest verification step, and complete this triage item. Do not claim a code fix.",
        priority: "high",
      },
      prompt:
        "Read the assigned synthetic Work item and synthetic timeout runbook. Record confirmed evidence, the likely root cause, uncertainty, and the smallest next verification step. Complete the triage item when that diagnosis is documented.",
      rubric: {
        requiresWorkRead: true,
        requiresDocsRead: true,
        requiresWorkWrite: true,
        expectedIssueStatus: "done",
        maxCreatedWorkItems: 0,
      },
    },
  ],
  upgradeNotes: [],
} satisfies OperatorPackManifest;

export const OFFICIAL_OPERATOR_PACKS = [
  founderOps,
  salesOps,
  engineeringOps,
].map((manifest) => parseOperatorPackManifest(manifest));

export function getOfficialOperatorPack(id: string) {
  return OFFICIAL_OPERATOR_PACKS.find((pack) => pack.id === id) ?? null;
}
