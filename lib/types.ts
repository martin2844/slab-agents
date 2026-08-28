import type { RunContextProfile } from "@/lib/run-context-profile";
import type { AutomationMode, RunMode, RunTrigger } from "@/lib/run-execution";
import type {
  OperatorPackManifest,
  PackCapabilityCategory,
} from "@/lib/packs/manifest";

export type Agent = {
  id: string;
  name: string;
  slug: string;
  role: string;
  instructions: string;
  runtime: string;
  model: string;
  enabled: boolean;
  fullAccess: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ToolPolicyMode = "approve" | "prompt" | "deny";

export type AgentToolPolicy = {
  agentId: string;
  serverName: string;
  defaultMode: ToolPolicyMode;
  tools: Record<string, ToolPolicyMode>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type AgentToolCatalogTool = {
  name: string;
  label: string;
  description: string;
  readOnly: boolean;
  legacyMode: ToolPolicyMode;
  maximumMode: "approve" | "prompt";
};

export type AgentToolCatalogServer = {
  serverName: string;
  label: string;
  description: string;
  integrationId: string | null;
  tools: AgentToolCatalogTool[];
};

export type RunToolPolicySnapshot = {
  runId: string;
  agentId: string;
  policies: Record<
    string,
    { defaultMode: ToolPolicyMode; tools: Record<string, ToolPolicyMode> }
  >;
  capturedAt: string;
};

export type AgentQuickAction = {
  id: string;
  agentId: string;
  label: string;
  prompt: string;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type Thread = {
  id: string;
  agentId: string;
  title: string;
  runtimeThreadId: string | null;
  runtime: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Message = {
  id: string;
  threadId: string;
  runId: string | null;
  role: "user" | "assistant" | "system";
  body: string;
  createdAt: string;
};

export type RunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

export type Run = {
  id: string;
  agentId: string;
  threadId: string | null;
  automationId: string | null;
  trigger: RunTrigger;
  mode: RunMode;
  issueKey: string | null;
  runInstructions: string;
  status: RunStatus;
  runtime: string;
  model: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  usage: Record<string, unknown> | null;
  createdAt: string;
  queuedAt: string;
  attemptCount: number;
  runnerRunId: string | null;
  runnerEventId: number;
};

export type RunEvent = {
  id: string;
  runId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type Automation = {
  id: string;
  name: string;
  agentId: string;
  agentName?: string;
  triggerType: "schedule" | "email";
  cronExpression: string | null;
  emailAccountId: string | null;
  prompt: string;
  mode: AutomationMode;
  enabled: boolean;
  lastRunAt: string | null;
  lastScheduledFor: string | null;
  missedRunPolicy: "skip" | "latest_once";
  lastRunId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Approval = {
  id: string;
  runId: string;
  runnerApprovalId: string;
  command: string;
  details: Record<string, unknown>;
  status: "pending" | "resolving" | "approved" | "denied";
  createdAt: string;
  resolvedAt: string | null;
};

export type Project = {
  id?: string;
  key: string;
  name: string;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type IssueStatus = "new" | "in_progress" | "blocked" | "review" | "done";
export type IssuePriority = "critical" | "high" | "medium" | "low";

export type Issue = {
  id: string;
  key: string;
  project_id?: string;
  project_key?: string;
  number?: number;
  title: string;
  description?: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  type: "epic" | "story" | "task" | "bug";
  assignee?: string | null;
  labels?: string[];
  version: number;
  created_at?: string;
  updated_at?: string;
  resolved_at?: string | null;
};

export type Comment = {
  id: string;
  issue_id?: string;
  author: string;
  body: string;
  created_at: string;
};

export type Document = {
  id: string;
  slug: string;
  title: string;
  body: string;
  parent_id: string | null;
  collection_id: string;
  tags: string[];
  author: string;
  revision: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DocumentSummary = Pick<
  Document,
  | "id"
  | "slug"
  | "title"
  | "parent_id"
  | "collection_id"
  | "tags"
  | "archived_at"
  | "created_at"
  | "updated_at"
>;

export type DocumentSearchResult = Pick<
  Document,
  "id" | "slug" | "title" | "tags" | "collection_id" | "updated_at"
> & {
  excerpt: string;
  score: number;
};

export type DocumentMutationResult = DocumentSummary & {
  changed_fields: string[];
};

export type DocumentRevision = {
  id?: string;
  document_id?: string;
  revision: number;
  title: string;
  body: string;
  author?: string;
  created_at: string;
};

export type OverviewData = {
  agents: {
    total: number;
    running: number;
    queued: number;
    waitingApproval: number;
    idle: number;
  };
  work: {
    open: number;
    inProgress: number;
    blocked: number;
    review: number;
    connected: boolean;
  };
  integrations: { total: number; healthy: number; issues: number };
  automations: Automation[];
  attention: {
    approvals: number;
    failedRuns: number;
    blockedWork: number;
    reviewWork: number;
    integrationIssues: number;
  };
  activeRuns: Run[];
  recentRuns: Run[];
  setup: SetupStatus;
  agentsList: Agent[];
};

export type SetupService = "work" | "docs" | "runner" | "codex";
export type SetupState =
  "connected" | "not_tested" | "failed" | "missing_config";

export type SetupCheck = {
  service: SetupService;
  label: string;
  state: SetupState;
  detail: string;
  checkedAt: string | null;
};

export type SetupStatus = {
  checks: SetupCheck[];
  connected: number;
  total: number;
  ready: boolean;
};

export type AgentDetailData = {
  agent: Agent;
  knowledgeSources: KnowledgeSource[];
  integrations: Integration[];
  toolPolicies: AgentToolPolicy[];
  toolCatalog: AgentToolCatalogServer[];
  quickActions: AgentQuickAction[];
  threads: Thread[];
  automations: Automation[];
  runs: Run[];
  runtimes: RuntimeCatalogItem[];
};

export type ThreadData = {
  thread: Thread;
  agent: Agent;
  messages: Message[];
};

export type RunsData = { runs: Run[]; approvals: Approval[]; agents: Agent[] };

export type RunDetailData = {
  run: Run;
  events: RunEvent[];
  approvals: Approval[];
  contextProfile: RunContextProfile;
  budget: RunBudgetSnapshot | null;
};

export type AutomationsData = {
  automations: Automation[];
  agents: Agent[];
  emailAccounts: EmailAccount[];
  emailAccess: Array<{
    agentId: string;
    accountIds: string[];
    readEnabled: boolean;
  }>;
  emailConfigured: boolean;
  emailError: string | null;
};

export type WorkPageData = {
  projects: Project[];
  projectKey: string;
  issues: Issue[];
  agents: Agent[];
  error: string;
  externalUrl: string | null;
};

export type DocsDetail = {
  document: Document;
  revisions: DocumentRevision[];
};

export type DocsPageData = {
  documents: DocumentSummary[];
  selected: string | null;
  detail: DocsDetail | null;
  error: string;
};

export type KnowledgeSourceKind = "wordpress" | "github" | "website";
export type KnowledgeSourceStatus =
  "never_synced" | "syncing" | "healthy" | "error" | "disabled" | "deleting";
export type KnowledgeSourceAuthType =
  "none" | "basic" | "bearer" | "github_app";

export type WordPressSourceConfig = {
  kind: "wordpress";
  siteUrl: string;
  authType: "none" | "basic" | "bearer";
  username: string | null;
  contentTypes: string[];
  publishedOnly: boolean;
  maxDocuments: number;
};

export type GitHubSourceConfig = {
  kind: "github";
  repository: string;
  branch: string;
  authType: "none" | "bearer" | "github_app";
  pathPrefixes: string[];
  extensions: string[];
  maxDocuments: number;
};

export type WebsiteSourceConfig = {
  kind: "website";
  siteUrl: string;
  sitemapUrl: string | null;
  authType: "none" | "basic" | "bearer";
  username: string | null;
  includePathPrefixes: string[];
  maxDocuments: number;
};

export type KnowledgeSourceConfig =
  WordPressSourceConfig | GitHubSourceConfig | WebsiteSourceConfig;

export type KnowledgeSource = {
  id: string;
  name: string;
  slug: string;
  kind: KnowledgeSourceKind;
  config: KnowledgeSourceConfig;
  authType: KnowledgeSourceAuthType;
  secretConfigured: boolean;
  githubAppId: string | null;
  enabled: boolean;
  version: number;
  accessVersion: number;
  agentIds: string[];
  syncIntervalMinutes: number | null;
  status: KnowledgeSourceStatus;
  lastSyncStartedAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  rootDocumentId: string | null;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
};

export type GitHubSourceApp = {
  id: string;
  name: string;
  organization: string | null;
  appId: string | null;
  appSlug: string | null;
  installationId: string | null;
  accountLogin: string | null;
  status:
    "pending_registration" | "pending_installation" | "connected" | "error";
  lastVerifiedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GitHubRepositoryOption = {
  id: number;
  fullName: string;
  defaultBranch: string;
  private: boolean;
};

export type SourcesPageData = {
  sources: KnowledgeSource[];
  githubApps: GitHubSourceApp[];
  agents: Array<Pick<Agent, "id" | "name" | "role" | "enabled">>;
};

export type WorkspaceSettings = {
  workMcpUrl: string;
  workApiKeyConfigured: boolean;
  docsMcpUrl: string;
  docsApiKeyConfigured: boolean;
  runnerUrl: string;
  operatorDisplayName: string;
  coordinationReviewer: string;
  memoryProvider: "disabled" | "honcho";
  honchoUrl: string;
  honchoApiKeyConfigured: boolean;
  honchoWorkspaceId: string;
  memoryMaxContextTokens: number;
};

export type RuntimeCatalogItem = {
  id: string;
  displayName: string;
  stability: "stable" | "experimental";
  authModes: string[];
  capabilities: Record<string, boolean>;
  registered: boolean;
  enabled: boolean;
  configured: boolean;
  authMode: "runtime_owned" | "api_key";
  health:
    "available" | "authentication_required" | "unavailable" | "not_tested";
  healthDetail: string;
  lastVerifiedAt: string | null;
  configVersion: number;
  models: string[];
  defaultModel: string;
  baseUrl: string | null;
  apiFormat: "responses" | "chat_completions" | null;
  providerRouting: {
    requireParameters: boolean;
    dataCollection: "allow" | "deny";
    zdr: boolean;
  } | null;
};

export type BudgetPolicy = {
  version: number;
  maxTokensPerRun: number | null;
  maxCostUsdPerRun: number | null;
  dailyCostUsd: number | null;
  monthlyCostUsd: number | null;
};

export type AgentBudgetPolicy = {
  agentId: string;
  maxTokensPerRun: number | null;
  maxCostUsdPerRun: number | null;
};

export type RuntimeModelPrice = {
  runtimeId: string;
  model: string;
  version: number;
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

export type BudgetConfiguration = {
  workspace: BudgetPolicy;
  agents: AgentBudgetPolicy[];
  prices: RuntimeModelPrice[];
};

export type SystemUpdateChannel = "stable" | "candidate";
export type SystemUpdateAction = "check" | "apply";
export type SystemUpdateRequestState =
  "submitted" | "running" | "succeeded" | "failed";

export type SystemUpdateComponentIdentity = {
  ref: string;
  digest: string;
  revision: string | null;
};

export type SystemUpdateComponent = {
  id: "agents" | "work" | "docs" | "email" | "runner";
  name: string;
  services: string[];
  installed: SystemUpdateComponentIdentity | null;
  available: SystemUpdateComponentIdentity | null;
  status: "up_to_date" | "update_available" | "recovery_required";
};

export type SystemUpdateCheckResult = {
  schemaVersion: 1;
  status:
    | "up_to_date"
    | "update_available"
    | "channel_equivalent"
    | "channel_older"
    | "recovery_required";
  channel: SystemUpdateChannel;
  installedStackVersion: string;
  availableStackVersion: string;
  checkedAt: string;
  recoveryReason: string | null;
  release: {
    releasedAt: string | null;
    severity: "routine" | "security" | "critical";
    releaseNotesUrl: string | null;
    rollbackCompatibleFromInstalled: boolean;
  };
  components: SystemUpdateComponent[];
};

export type SystemUpdateRequest = {
  id: string;
  action: SystemUpdateAction;
  channel: SystemUpdateChannel;
  target: string | null;
  source: "manual" | "scheduled";
  state: SystemUpdateRequestState;
  requestedAt: string;
  expiresAt: string;
  startedAt: string | null;
  completedAt: string | null;
  result: SystemUpdateCheckResult | null;
  error: { code: string; message: string } | null;
  automaticDecision:
    "apply_submitted" | "up_to_date" | "unsafe" | "not_applicable" | null;
  scheduledFor: string | null;
  parentRequestId: string | null;
  followUpRequestId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SystemUpdatePolicy = {
  version: number;
  enabled: boolean;
  checkHourUtc: number;
  lastScheduledAt: string | null;
  updatedAt: string;
};

export type SystemUpdatesData = {
  bridge: {
    available: boolean;
    message: string;
  };
  policy: SystemUpdatePolicy;
  latestRequest: SystemUpdateRequest | null;
  latestCheck: SystemUpdateRequest | null;
  requests: SystemUpdateRequest[];
};

export type UsageCostSource =
  | "provider_reported"
  | "sdk_estimated"
  | "pricing_snapshot"
  | "unpriced"
  | "no_usage";

export type UsageSummaryPeriod = "today" | "7d" | "30d" | "month" | "all";

export type UsageSummaryBreakdown = {
  key: string;
  label: string;
  context: string | null;
  runs: number;
  tokens: number;
  providerReportedUsd: number;
  sdkEstimatedUsd: number;
  pricingEstimatedUsd: number;
  unpricedTokens: number;
};

export type UsageBudgetWindow = {
  limitUsd: number | null;
  spentUsd: number;
  committedUsd: number;
  activeReservedUsd: number;
};

export type UsageSummary = {
  period: UsageSummaryPeriod;
  basis: "budget_admission_at";
  from: string | null;
  to: string;
  generatedAt: string;
  costs: {
    trackedUsd: number;
    providerReportedUsd: number;
    sdkEstimatedUsd: number;
    pricingEstimatedUsd: number;
  };
  tokens: {
    input: number;
    cachedInput: number;
    output: number;
    total: number;
    cacheHitRate: number | null;
    unpriced: number;
  };
  runs: {
    total: number;
    priced: number;
    unpriced: number;
    active: number;
  };
  budgets: {
    day: UsageBudgetWindow;
    month: UsageBudgetWindow;
  };
  breakdowns: {
    runtimes: UsageSummaryBreakdown[];
    models: UsageSummaryBreakdown[];
    agents: UsageSummaryBreakdown[];
  };
};

export type RunBudgetSnapshot = {
  runId: string;
  status: "reserved" | "active" | "rejected" | "settled" | "exceeded";
  terminalStatus: string | null;
  policyVersion: number;
  pricingVersion: number | null;
  maxTokens: number | null;
  maxCostUsd: number | null;
  reservedCostUsd: number;
  actualInputTokens: number;
  actualCachedInputTokens: number;
  actualOutputTokens: number;
  actualTokens: number;
  actualCostUsd: number | null;
  actualCostSource: UsageCostSource | null;
  reason: string | null;
};

export type CalendarProvider =
  | "calendar_google"
  | "calendar_microsoft"
  | "calendar_caldav"
  | "calendar_calcom"
  | "calendar_ics";
export type IntegrationProvider =
  "posthog" | "custom_http" | "custom_mcp" | CalendarProvider;
// Keep the historic values plus explicit disabled state for configured-but-paused integrations.
export type IntegrationStatus =
  "connected" | "failed" | "not_tested" | "disabled";
export type IntegrationAuthType = "none" | "bearer" | "api_key_header";

export type IntegrationCatalogItem = {
  provider: IntegrationProvider;
  name: string;
  description: string;
  available: boolean;
  tools: IntegrationTool[];
};
export type IntegrationTool = {
  key: string;
  name: string;
  description: string;
  readOnly: boolean;
};
export type IntegrationOperationParameter = {
  name: string;
  location: "path" | "query";
  type: "string" | "number" | "integer" | "boolean";
  required: boolean;
  description?: string;
};
export type CustomHttpIntegrationDraft = {
  schemaVersion: 1;
  name: string;
  baseUrl: string;
  authType: IntegrationAuthType;
  authHeaderName?: string;
  timeoutMs: number;
  operations: Array<{
    key: string;
    name: string;
    description: string;
    method: "GET" | "HEAD";
    path: string;
    parameters: IntegrationOperationParameter[];
    responsePath?: string;
    maxResponseBytes: number;
    maxItems: number | null;
  }>;
  sourceFormat: "manifest_json" | "markdown" | "ai";
  warnings: string[];
};
export type CustomHttpEditableDefinition = Omit<
  CustomHttpIntegrationDraft,
  "sourceFormat" | "warnings"
>;
export type CustomHttpAiChange = {
  kind: "added" | "removed" | "changed";
  operationKey: string;
  field: string | null;
  before: string | null;
  after: string | null;
};
export type CustomHttpAiProposal = {
  draft: CustomHttpIntegrationDraft;
  summary: string;
  changes: CustomHttpAiChange[];
  runtime: { id: string; model: string | null };
  usage: { totalTokens: number | null };
};
export type IntegrationHttpOperation = {
  id: string;
  integrationId: string;
  key: string;
  name: string;
  description: string;
  method: "GET" | "HEAD";
  path: string;
  parameters: IntegrationOperationParameter[];
  responsePath?: string;
  maxResponseBytes: number | null;
  maxItems: number | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  timeoutMs: number | null;
};
export type IntegrationMcpTool = {
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown>;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean | null;
  openWorldHint: boolean | null;
};
export type Integration = {
  id: string;
  provider: IntegrationProvider;
  name: string;
  slug: string;
  datacenter?: "us" | "eu";
  baseUrl?: string;
  accountEmail?: string | null;
  accountName?: string | null;
  writePolicy?: CalendarWritePolicy;
  oauthConfigured?: boolean;
  calendarId?: string | null;
  calendarUsername?: string | null;
  calendarTenant?: string | null;
  calendarEventTypeId?: number | null;
  timeoutMs?: number | null;
  kind?: "read" | "readwrite";
  enabled: boolean;
  version?: number;
  authType?: IntegrationAuthType;
  authHeaderName?: string | null;
  status: IntegrationStatus;
  hasApiKey: boolean;
  hasSecret?: boolean;
  operations?: IntegrationHttpOperation[];
  mcpTools?: IntegrationMcpTool[];
  lastTestedAt: string | null;
  lastError: string | null;
  permissions: Record<string, string[]>;
  tools: IntegrationTool[];
  createdAt: string;
  updatedAt: string;
};
export type IntegrationsPageData = {
  integrations: Integration[];
  agents: Agent[];
  catalog: IntegrationCatalogItem[];
};

export type EmailSendPolicy = "disabled" | "approval_required" | "autonomous";
export type CalendarWritePolicy =
  "disabled" | "approval_required" | "autonomous";

export type CalendarIntegrationState = {
  integrations: Integration[];
  agents: Agent[];
  googleCallbackUrl: string;
  microsoftCallbackUrl: string;
  oauthResult: "connected" | "failed" | null;
};
export type EmailAccount = {
  id: string;
  provider:
    | "proton_bridge"
    | "imap_smtp"
    | "gmail"
    | "microsoft_graph"
    | "agentmail"
    | "resend";
  emailAddress: string;
  displayName: string;
  enabled: boolean;
  managed: boolean;
  managedBridgeLogin: string | null;
  capabilities: {
    read: boolean;
    search: boolean;
    draft: boolean;
    send: boolean;
    reply: boolean;
    threads: boolean;
  };
  createdAt: string;
  updatedAt: string;
  lastConnectionStatus: string | null;
  lastConnectionAt: string | null;
  connection: {
    imapHost: string;
    imapPort: number;
    imapTlsMode: "ssl" | "starttls" | "none";
    smtpHost: string;
    smtpPort: number;
    smtpTlsMode: "ssl" | "starttls" | "none";
  };
  providerConfig: {
    inboxId: string;
    baseUrl: string;
    inboundEnabled: boolean;
  };
};
export type ManagedProtonBridgeState = {
  available: boolean;
  version: string | null;
  state: "unavailable" | "stopped" | "starting" | "ready" | "error";
  message?: string;
  accounts: Array<{ emailAddress: string; state: string }>;
};
export type ManagedProtonChallenge = {
  state: "challenge_required";
  challengeId: string;
  challengeType: "two_factor" | "mailbox_password" | "human_verification";
  expiresAt: string;
  verificationUrl?: string;
};
export type AgentEmailAccess = {
  agentId: string;
  profileId: string;
  profileName: string;
  accountIds: string[];
  readEnabled: boolean;
  draftEnabled: boolean;
  sendEnabled: boolean;
  sendPolicy: EmailSendPolicy;
  tokenId: string;
  tokenPrefix: string;
  tokenCreatedAt: string;
  createdAt: string;
  updatedAt: string;
};
export type GmailOAuthSettings = {
  configured: boolean;
  clientId: string;
  hasClientSecret: boolean;
  source: "stored" | "environment" | "missing";
  updatedAt: string | null;
};
export type MicrosoftOAuthSettings = GmailOAuthSettings & {
  tenant: string;
};
export type EmailIntegrationState = {
  configured: boolean;
  adminConfigured: boolean;
  serviceUrl: string;
  status: IntegrationStatus;
  lastTestedAt: string | null;
  lastError: string | null;
  gmailOAuth: GmailOAuthSettings;
  microsoftOAuth: MicrosoftOAuthSettings;
  protonBridge: ManagedProtonBridgeState;
  accounts: EmailAccount[];
  assignments: AgentEmailAccess[];
};

export type InboundEmailEvent = {
  id: number;
  accountId: string;
  provider: EmailAccount["provider"];
  messageId: string;
  threadId: string | null;
  from: { name?: string; address: string };
  to: Array<{ name?: string; address: string }>;
  omittedRecipientCount?: number;
  subject: string;
  receivedAt: string;
  discoveredAt: string;
};

export type EmailAutomationOccurrence = {
  automationId: string;
  inboundEventId: number;
  runId: string;
  event: InboundEmailEvent;
  status: "pending" | "dispatched" | "skipped";
  skipReason: string | null;
  attemptCount: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  dispatchedAt: string | null;
};

export type OperatorPackInstallationStatus =
  "installing" | "installed" | "partial_failure" | "disabled";

export type OperatorPackInstallation = {
  packId: string;
  packVersion: string;
  source: "official" | "local";
  status: OperatorPackInstallationStatus;
  manifest: OperatorPackManifest;
  lastError: string | null;
  installedAt: string;
  disabledAt: string | null;
  updatedAt: string;
};

export type OperatorPackResourceType =
  "agent" | "quick_action" | "automation" | "doc";

export type OperatorPackResource = {
  id: string;
  packId: string;
  resourceType: OperatorPackResourceType;
  resourceKey: string;
  resourceId: string | null;
  managed: boolean;
  createdByPack: boolean;
  reattachable: boolean;
  state: "applied" | "failed" | "detached";
  baseline: Record<string, unknown>;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OperatorPackAcceptanceStatus =
  "preparing" | "queued" | "running" | "evaluating" | "passed" | "failed";

export type OperatorPackAcceptance = {
  id: string;
  packId: string;
  scenarioId: string;
  packVersion: string;
  runId: string | null;
  projectKey: string | null;
  issueKey: string | null;
  docId: string | null;
  status: OperatorPackAcceptanceStatus;
  rubric: Record<string, unknown>;
  evidence: Record<string, unknown>;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  updatedAt: string;
};

export type OperatorPackCapabilityState = {
  category: PackCapabilityCategory;
  required: boolean;
  available: boolean;
  description: string;
};

export type OperatorPackPreviewChange = {
  resourceType: OperatorPackResourceType;
  resourceKey: string;
  label: string;
  action:
    "create" | "update" | "preserve" | "conflict" | "unchanged" | "detach";
  baseline?: Record<string, unknown>;
  current?: Record<string, unknown>;
  proposed: Record<string, unknown>;
  userModified: boolean;
};

export type OperatorPackPreview = {
  pack: OperatorPackManifest;
  source: "official" | "local";
  installation: OperatorPackInstallation | null;
  changes: OperatorPackPreviewChange[];
  capabilities: OperatorPackCapabilityState[];
  permissions: OperatorPackManifest["permissions"];
  conflicts: number;
  remoteChanges: number;
};

export type OperatorPackSummary = {
  manifest: OperatorPackManifest;
  source: "official" | "local";
  installation: OperatorPackInstallation | null;
  capabilities: OperatorPackCapabilityState[];
  configured: boolean;
  updateAvailable: boolean;
  acceptance: OperatorPackAcceptance | null;
};

export type OperatorPackMetrics = {
  total: number;
  passed: number;
  failed: number;
  running: number;
  passRate: number | null;
  medianMinutesToAcceptedOutcome: number | null;
};

export type OperatorPacksPageData = {
  packs: OperatorPackSummary[];
  metrics: OperatorPackMetrics;
};
