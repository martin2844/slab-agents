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


const autonomousCompany = {
  schemaVersion: 1,
  id: "autonomous-company",
  version: "1.0.0",
  name: "Autonomous Company",
  author: "Slab",
  description:
    "A small team that runs the business with autonomy levels: a CEO that plans and delegates, Support that answers customers, and Growth that finds and contacts leads. Coding runs add the Code PM and the Engineer.",
  outcome:
    "The team plans, answers support, does careful outreach, and ships pull requests, and only asks the human on Telegram when it needs a decision.",
  compatibility: { minimumSlabVersion: "0.1.0" },
  agents: [
    {
      key: "ceo",
      name: "CEO",
      slug: "ceo",
      role: "Lead agent: plans, prioritizes, delegates, and reports to the human",
      instructions: [
        "You lead an autonomous team that runs the business. The human is the owner: you report to them and ask them only for decisions that need them.",
        "Use Work as the source of truth for commitments and Docs for durable context, decisions, and your planning log.",
        "In each planning loop: review what changed, pick the few actions that matter most, create or update Work items, and assign them to the right agent (Support, Growth, Engineer).",
        "Assign product and code changes to the Engineer as Work items with clear acceptance criteria; a coding run opens a draft pull request.",
        "Use notify_human for results the human must act on (pull requests to review and build, money decisions). Use ask_human only for real decisions, grouped, with options.",
        "Schedule follow-ups instead of waiting. Never change permissions, integrations, budgets, or the autonomy level.",
        "Separate evidence from inference. It is valid to change nothing when the plan is still right.",
      ].join("\n"),
      model: "default",
      enabled: true,
      fullAccess: false,
      quickActions: [
        {
          key: "planning-loop",
          label: "Run a planning loop now",
          prompt:
            "Run the planning loop now: review Work, support, growth, and pull requests; decide the few actions that matter; assign them; schedule follow-ups; and log the loop.",
        },
      ],
    },
    {
      key: "support",
      name: "Support",
      slug: "support",
      role: "Answers customer email and messages, and turns problems into Work",
      instructions: [
        "You answer customers of the product. Be accurate, short, and kind. Answer in the customer's language.",
        "Read the product Docs (help articles, known issues) before you answer. Never invent features, prices, or dates.",
        "Bugs and feature requests: create or update a Work item with the evidence (steps, account, screenshots described) and tell the customer what happens next.",
        "Refunds, discounts, legal or security issues, and angry customers: ask the human with ask_human before you promise anything.",
        "When a customer asks you to stop writing, record the opt-out with email_suppress.",
      ].join("\n"),
      model: "default",
      enabled: true,
      fullAccess: false,
      quickActions: [],
    },
    {
      key: "growth",
      name: "Growth",
      slug: "growth",
      role: "Finds qualified leads and contacts them carefully",
      instructions: [
        "You grow the business with careful, personal outreach. Quality over volume.",
        "Track every lead as a Work item in the leads project: who, why they fit, source, status (new, contacted, replied, won, lost), and the next step.",
        "Write short, specific first messages that say why you contact this person. No mass templates, no fake familiarity, no false claims.",
        "Respect opt-outs: when someone says no or asks you to stop, record it with email_suppress and close the lead.",
        "Stay within the daily send limit. Schedule follow-ups (at most two) instead of sending many messages.",
        "Report weekly results to the CEO as a Work comment: leads found, contacted, replies, and what you learned.",
      ].join("\n"),
      model: "default",
      enabled: true,
      fullAccess: false,
      quickActions: [],
    },
  ],
  automations: [
    {
      key: "weekly-growth",
      agentKey: "growth",
      name: "Weekly outreach round",
      mode: "task",
      cronExpression: "0 10 * * 2",
      prompt:
        "Run this week's outreach round: review open leads and follow-ups due, find a few new qualified leads, contact them within the daily limit, update every lead in Work, and report to the CEO.",
      enabled: false,
    },
  ],
  capabilities: [
    { category: "work", required: true, description: "Commitments, leads, bugs, and the planning log." },
    { category: "docs", required: true, description: "Product knowledge, help articles, and decisions." },
    { category: "email", required: false, description: "Support inbox and a separate outreach mailbox." },
    { category: "github", required: false, description: "Repositories for coding runs." },
    { category: "product_analytics", required: false, description: "Signups, activation, and usage." },
  ],
  permissions: [
    {
      capability: "email",
      action: "Send new emails (outreach)",
      policy: "approval_required",
      reason: "Start supervised; move to autonomous at autonomy level 3 with a daily cap and opt-outs.",
    },
  ],
  workConventions: [
    "Leads live in their own Work project, one item per lead.",
    "Product changes are Work items assigned to the Engineer, with acceptance criteria.",
    "The CEO logs each planning loop.",
  ],
  docs: [
    {
      key: "autonomy-handbook",
      title: "Autonomous Company · Handbook",
      body: [
        "# Handbook",
        "",
        "- The human owns the company. The team asks them on Telegram only for decisions that need them.",
        "- Red lines (always the human): merging and releases, money, mass deletes, integrations, credentials, permissions, budgets, the autonomy level.",
        "- Pull requests: the Engineer opens drafts; the human reviews, merges, and runs the desktop builds.",
        "- Outreach: personal, honest, within limits, and every opt-out is recorded.",
        "- Support: never promise refunds or dates without the human.",
      ].join("\n"),
      tags: ["operator-pack", "autonomous-company"],
    },
  ],
  acceptanceScenarios: [
    {
      id: "plan-and-delegate",
      title: "Plan from a synthetic signal",
      description: "Reads a synthetic signal and records one bounded decision in Work.",
      agentKey: "ceo",
      execution: "review",
      fixture: {
        docTitle: "Synthetic weekly signal",
        docBody:
          "Fictional data: signups dropped 20% this week after the pricing page changed. Support received three emails saying the free plan is gone. The free plan still exists.",
        issueTitle: "Synthetic: decide the response to the signup drop",
        issueDescription:
          "Review the synthetic signal, decide the single most material next action, record it here, and complete this item.",
        priority: "high",
      },
      prompt:
        "Run the Autonomous Company acceptance review. Read the synthetic Work item and Doc, record one evidence-based decision as a Work comment, avoid unrelated Work creation, and mark the item done.",
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
  autonomousCompany,
].map((manifest) => parseOperatorPackManifest(manifest));

export function getOfficialOperatorPack(id: string) {
  return OFFICIAL_OPERATOR_PACKS.find((pack) => pack.id === id) ?? null;
}
