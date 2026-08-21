import type { RunContextProfile } from "@/lib/run-context-profile";
import type { AutomationMode, RunMode, RunTrigger } from "@/lib/run-execution";

export type Agent = {
  id: string;
  name: string;
  slug: string;
  role: string;
  instructions: string;
  runtime: "codex";
  model: string;
  enabled: boolean;
  fullAccess: boolean;
  createdAt: string;
  updatedAt: string;
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
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  usage: Record<string, unknown> | null;
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
  cronExpression: string | null;
  prompt: string;
  mode: AutomationMode;
  enabled: boolean;
  lastRunAt: string | null;
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
  | "tags"
  | "archived_at"
  | "created_at"
  | "updated_at"
>;

export type DocumentSearchResult = Pick<
  Document,
  "id" | "slug" | "title" | "tags" | "updated_at"
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
  integrations: Integration[];
  quickActions: AgentQuickAction[];
  threads: Thread[];
  automations: Automation[];
  runs: Run[];
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
};

export type AutomationsData = {
  automations: Automation[];
  agents: Agent[];
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

export type WorkspaceSettings = {
  workMcpUrl: string;
  workApiKeyConfigured: boolean;
  docsMcpUrl: string;
  docsApiKeyConfigured: boolean;
  runnerUrl: string;
};

export type IntegrationProvider = "posthog" | "custom_http" | "custom_mcp";
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
export type EmailAccount = {
  id: string;
  provider: "proton_bridge" | "imap_smtp" | "gmail";
  emailAddress: string;
  displayName: string;
  enabled: boolean;
  managed: boolean;
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
export type EmailIntegrationState = {
  configured: boolean;
  adminConfigured: boolean;
  serviceUrl: string;
  status: IntegrationStatus;
  lastTestedAt: string | null;
  lastError: string | null;
  gmailOAuth: GmailOAuthSettings;
  protonBridge: ManagedProtonBridgeState;
  accounts: EmailAccount[];
  assignments: AgentEmailAccess[];
};
