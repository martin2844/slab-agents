import Link from "next/link";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  Bot,
  Boxes,
  BrainCircuit,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  Cloud,
  Code2,
  Database,
  FileText,
  FolderKanban,
  Gauge,
  Globe2,
  KeyRound,
  Laptop,
  ListChecks,
  LockKeyhole,
  Mail,
  Network,
  Play,
  PlugZap,
  RefreshCw,
  Server,
  Settings2,
  ShieldCheck,
  TerminalSquare,
  TestTube2,
  UserRoundPlus,
  Users,
  Workflow,
  Wrench,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const chapters = [
  ["01", "Ecosystem", "#ecosystem"],
  ["02", "Bring it online", "#setup"],
  ["03", "Create agents", "#agents"],
  ["04", "Memory", "#memory"],
  ["05", "Create tools", "#tools"],
  ["06", "Email", "#email"],
  ["07", "Gmail", "#gmail"],
  ["08", "Proton Bridge", "#proton"],
  ["09", "Calendar", "#calendar"],
  ["10", "Run lifecycle", "#runs"],
  ["11", "Troubleshooting", "#troubleshooting"],
] as const;

type Icon = React.ComponentType<{ className?: string }>;
type Tone = "default" | "accent" | "dark" | "muted" | "success";

function DiagramNode({
  label,
  title,
  detail,
  icon: IconComponent,
  tone = "default",
  className,
}: {
  label: string;
  title: string;
  detail: string;
  icon: Icon;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border p-4",
        tone === "default" && "bg-card",
        tone === "muted" && "bg-muted/50",
        tone === "accent" && "border-primary/40 bg-primary/8",
        tone === "dark" && "border-petrol-deep bg-petrol-deep text-white",
        tone === "success" &&
          "border-accent bg-accent-muted/60",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn(
            "font-mono text-[0.68rem] font-medium uppercase tracking-[0.02em]",
            tone === "dark" ? "text-white/60" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
        <IconComponent className="size-4 shrink-0" />
      </div>
      <p className="mt-4 text-base font-semibold">{title}</p>
      <p
        className={cn(
          "mt-1.5 text-xs leading-5",
          tone === "dark" ? "text-white/70" : "text-muted-foreground",
        )}
      >
        {detail}
      </p>
    </div>
  );
}

function FlowArrow({ label }: { label?: string }) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center gap-1 px-2 py-1 text-muted-foreground">
      <ArrowDown className="size-4 lg:hidden" aria-hidden />
      <ArrowRight className="hidden size-4 lg:block" aria-hidden />
      {label ? (
        <span className="font-mono text-[0.62rem] font-medium uppercase tracking-[0.02em]">
          {label}
        </span>
      ) : null}
    </div>
  );
}

function GuideSection({
  id,
  number,
  title,
  description,
  icon: IconComponent,
  children,
}: {
  id: string;
  number: string;
  title: string;
  description: string;
  icon: Icon;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 border-t pt-7">
      <header className="grid gap-4 md:grid-cols-[3rem_minmax(0,1fr)]">
        <div className="flex size-9 items-center justify-center rounded-md border bg-card font-mono text-xs text-primary">
          {number}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <IconComponent className="size-4 text-primary" />
            <h2 className="font-heading text-3xl font-[675] tracking-[-.035em] sm:text-4xl">
              {title}
            </h2>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
      </header>
      <div className="mt-7">{children}</div>
    </section>
  );
}

function Step({
  number,
  title,
  children,
  result,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
  result?: string;
}) {
  return (
    <li className="grid gap-3 border-t py-4 first:border-t-0 sm:grid-cols-[2rem_11rem_minmax(0,1fr)]">
      <span className="pt-0.5 font-mono text-xs text-primary">{number}</span>
      <strong className="text-sm leading-6">{title}</strong>
      <div className="text-sm leading-6 text-muted-foreground">
        {children}
        {result ? (
          <p className="mt-2 flex items-start gap-2 text-xs font-medium text-foreground">
            <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
            {result}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function FieldRow({
  field,
  enter,
  note,
}: {
  field: string;
  enter: string;
  note?: string;
}) {
  return (
    <div className="grid gap-1 border-t py-3 first:border-t-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-5">
      <dt className="font-mono text-xs font-semibold text-foreground">
        {field}
      </dt>
      <dd className="text-sm leading-5 text-muted-foreground">
        {enter}
        {note ? <span className="block text-xs opacity-80">{note}</span> : null}
      </dd>
    </div>
  );
}

function Callout({
  title,
  children,
  tone = "default",
  icon: IconComponent = CircleAlert,
}: {
  title: string;
  children: React.ReactNode;
  tone?: "default" | "warning" | "success";
  icon?: Icon;
}) {
  return (
    <div
      className={cn(
        "min-w-0 grid gap-3 rounded-lg border p-4 sm:grid-cols-[auto_1fr]",
        tone === "default" && "bg-muted/35",
        tone === "warning" && "border-amber-700/25 bg-amber-500/10",
        tone === "success" && "border-accent bg-accent-muted/60",
      )}
    >
      <IconComponent
        className={cn(
          "mt-0.5 size-4",
          tone === "warning" && "text-amber-800",
          tone === "success" && "text-success",
          tone === "default" && "text-primary",
        )}
      />
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">
          {children}
        </div>
      </div>
    </div>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="min-w-0 max-w-full overflow-x-auto rounded-lg border border-sidebar-border bg-petrol-deep px-4 py-3 font-mono text-xs leading-5 text-white">
      <code>{children}</code>
    </pre>
  );
}

function TroubleshootingItem({
  title,
  symptom,
  children,
}: {
  title: string;
  symptom: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group border-t first:border-t-0">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 py-4 marker:hidden">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{symptom}</p>
        </div>
        <ChevronRight className="mt-1 size-4 shrink-0 transition-transform group-open:rotate-90" />
      </summary>
      <div className="max-w-3xl pb-5 text-sm leading-6 text-muted-foreground">
        {children}
      </div>
    </details>
  );
}

export function HowItWorksGuide() {
  return (
    <>
      <PageHeader
        title="How it works"
        description="Architecture, setup, providers, tools, agents, and the exact path from a fresh workspace to a running software team."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/settings">
                <Settings2 /> Settings
              </Link>
            </Button>
            <Button asChild>
              <Link href="/agents">
                <UserRoundPlus /> Create agent
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-10 grid overflow-hidden rounded-lg border bg-card md:grid-cols-[1.25fr_.75fr]">
        <div className="p-5 sm:p-7">
          <Badge variant="outline">Operator handbook</Badge>
          <p className="mt-4 max-w-5xl font-heading text-[clamp(4rem,6vw,6rem)] font-[700] leading-[0.98] tracking-[-0.055em]">
            Connect the company. Give agents a job. Keep every action visible.
          </p>
          <p className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
            Slab is a self-hosted control plane around separate sources of
            truth. Work owns execution, Docs owns durable knowledge, Email and
            custom integrations add capabilities, Runner executes Codex, and
            this app decides which agent acts and when.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button size="sm" asChild>
              <Link href="#setup">
                <Play /> Start setup
              </Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href="#gmail">
                <Mail /> Connect Gmail
              </Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href="#proton">
                <KeyRound /> Connect Proton
              </Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href="#calendar">
                <CalendarDays /> Connect Calendar
              </Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href="#tools">
                <Wrench /> Create a tool
              </Link>
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 border-t bg-muted/25 md:border-l md:border-t-0">
          {[
            [FolderKanban, "Work", "Operational truth"],
            [FileText, "Docs", "Company knowledge"],
            [Bot, "Agents", "Identity and policy"],
            [Activity, "Runs", "Execution and audit"],
          ].map(([IconComponent, title, detail], index) => (
            <div
              key={title as string}
              className={cn(
                "min-h-32 p-4",
                index % 2 === 0 && "border-r",
                index < 2 && "border-b",
              )}
            >
              <IconComponent className="size-4 text-primary" />
              <p className="mt-8 text-sm font-semibold">{title as string}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {detail as string}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-10 xl:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="xl:sticky xl:top-20 xl:h-fit">
          <p className="text-xs font-semibold text-muted-foreground">
            On this page
          </p>
          <nav className="mt-2 divide-y border-y" aria-label="Guide chapters">
            {chapters.map(([number, label, href]) => (
              <Link
                key={href}
                href={href}
                className="group flex min-h-9 items-center gap-3 text-sm"
              >
                <span className="font-mono text-[0.62rem] text-muted-foreground">
                  {number}
                </span>
                <span className="font-medium group-hover:text-primary">
                  {label}
                </span>
              </Link>
            ))}
          </nav>
          <p className="mt-5 border-l-2 border-primary pl-3 text-xs leading-5 text-muted-foreground">
            Start with Settings, then create one agent, assign only the tools it
            needs, and test one real operating loop.
          </p>
        </aside>

        <article className="min-w-0 space-y-20 pb-20">
          <GuideSection
            id="ecosystem"
            number="01"
            title="The ecosystem"
            description="The UI is unified, but ownership remains explicit. The browser never talks directly to MCP services and never receives their credentials."
            icon={Boxes}
          >
            <div className="rounded-lg border bg-muted/20 p-4 sm:p-5">
              <p className="mb-4 text-xs font-semibold text-muted-foreground">
                Public request path
              </p>
              <div className="flex flex-col items-stretch lg:flex-row lg:items-center">
                <DiagramNode
                  label="Human"
                  title="Browser"
                  detail="Workspace password, UI, approvals, chat, configuration, and audit views."
                  icon={Laptop}
                  tone="muted"
                  className="lg:flex-1"
                />
                <FlowArrow label="HTTPS" />
                <DiagramNode
                  label="Public edge"
                  title="Caddy"
                  detail="TLS certificates, HTTP to HTTPS redirect, and reverse proxy. The only public container."
                  icon={Globe2}
                  className="lg:flex-1"
                />
                <FlowArrow label="private network" />
                <DiagramNode
                  label="Control plane"
                  title="Slab Agents"
                  detail="Next.js UI, BFF, local SQLite, scheduler, agent policy, capability snapshots, and orchestration."
                  icon={Workflow}
                  tone="accent"
                  className="lg:flex-[1.2]"
                />
              </div>
              <div className="my-4 flex justify-center text-muted-foreground">
                <ArrowDown className="size-4" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                <DiagramNode
                  label="Source of truth"
                  title="Work"
                  detail="Projects, issues, comments, assignments, versions, blockers, and review state."
                  icon={FolderKanban}
                />
                <DiagramNode
                  label="Source of truth"
                  title="Docs"
                  detail="Markdown documents, hierarchy, search, revisions, and durable knowledge."
                  icon={FileText}
                />
                <DiagramNode
                  label="Capability service"
                  title="Email"
                  detail="Gmail, Proton Bridge, scoped mailbox profiles, encrypted provider credentials, and MCP tools."
                  icon={Mail}
                />
                <DiagramNode
                  label="Capabilities"
                  title="Calendar"
                  detail="Google, Microsoft, CalDAV, Cal.com, and private read-only ICS feeds with per-account write policy."
                  icon={CalendarDays}
                />
                <DiagramNode
                  label="Execution"
                  title="Runner"
                  detail="Codex app-server, event streaming, runtime threads, tool wiring, and approvals."
                  icon={TerminalSquare}
                  tone="dark"
                />
                <DiagramNode
                  label="Capabilities"
                  title="Integrations"
                  detail="PostHog, declarative read-only HTTP APIs, and remote Streamable HTTP MCP servers."
                  icon={PlugZap}
                  tone="success"
                />
              </div>
            </div>

            <div className="mt-5 grid overflow-hidden rounded-lg border bg-border sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["Work", "What needs to happen", "Slab"],
                ["Docs", "What the company knows", "Slab Docs"],
                ["Control", "Who acts and when", "Slab Agents"],
                ["Runtime", "How the agent executes", "Slab Runner + Codex"],
              ].map(([label, meaning, owner]) => (
                <div key={label} className="bg-card p-4">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-2 text-sm font-semibold">{meaning}</p>
                  <p className="mt-1 font-mono text-[0.65rem] text-muted-foreground">
                    owner: {owner}
                  </p>
                </div>
              ))}
            </div>

            <Callout title="Each service keeps its own truth" icon={Database}>
              Slab Agents stores orchestration: agents, product threads, runs,
              approvals, automations, settings, capability snapshots, and audit
              events. It does not mirror Work issues, Docs bodies, or mailbox
              contents into its database.
            </Callout>
          </GuideSection>

          <GuideSection
            id="setup"
            number="02"
            title="Bring the workspace online"
            description="A self-hosted installation runs the stack in Docker. Inside the product, the first operating check is Work, Docs, Runner, and at least one configured runtime."
            icon={Server}
          >
            <div className="grid gap-5 lg:grid-cols-[1fr_.8fr]">
              <ol className="rounded-lg border bg-card px-4">
                <Step number="01" title="Sign in">
                  Open your Slab Agents URL and enter the global workspace
                  password chosen during installation. The session is stored in
                  an HTTP-only cookie; the app is single-user but not publicly
                  open.
                </Step>
                <Step number="02" title="Connect Work">
                  Go to{" "}
                  <strong className="text-foreground">
                    Settings → Connections
                  </strong>
                  . Enter the Slab Work MCP URL and API key, save, then run the
                  connection test.
                </Step>
                <Step number="03" title="Connect Docs">
                  In the same tab, enter the Slab Docs MCP URL and API key. The
                  browser submits replacements to the Next.js backend and never
                  receives stored keys back.
                </Step>
                <Step number="04" title="Verify Runner">
                  Open{" "}
                  <strong className="text-foreground">
                    Settings → Runtime
                  </strong>
                  . Test Runner and each runtime separately. Codex uses the
                  bundled CLI account; Claude uses a write-only Anthropic API
                  key configured on this page.
                </Step>
                <Step
                  number="05"
                  title="Run setup check"
                  result="Work, Docs, Runner, and a runtime report connected"
                >
                  Return to Overview and run the setup check. Once all four core
                  systems are healthy, onboarding collapses into the operational
                  dashboard.
                </Step>
              </ol>
              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-sm font-semibold">
                    Self-hosted service layout
                  </p>
                  <dl className="mt-3 divide-y border-y">
                    <FieldRow
                      field="Caddy"
                      enter="Public ports 80/443 and automatic TLS"
                    />
                    <FieldRow
                      field="Slab Agents"
                      enter="Private Docker network; reached through Caddy"
                    />
                    <FieldRow
                      field="Work / Docs"
                      enter="Private services; no public host ports"
                    />
                    <FieldRow
                      field="Runner"
                      enter="Private execution service; never browser-facing"
                    />
                    <FieldRow
                      field="Email"
                      enter="Optional private connector and managed Proton lifecycle"
                    />
                  </dl>
                </div>
                <Callout title="Codex login on a VPS" icon={TerminalSquare}>
                  If runtime verification fails, authenticate the bundled
                  runtime from the server with:
                  <code className="mt-2 block font-mono text-foreground">
                    sudo slabctl codex login
                  </code>
                  Then test Runner again from Settings.
                </Callout>
                <Callout title="Claude API setup" icon={KeyRound}>
                  In Settings → Runtime, paste an Anthropic API key, save it,
                  and choose Test. Slab verifies the key and discovers models
                  server-side. The stored key is never returned to the browser
                  or added to an agent prompt.
                </Callout>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" asChild>
                    <Link href="/settings">Open Settings</Link>
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/">Open Overview</Link>
                  </Button>
                </div>
              </div>
            </div>
          </GuideSection>

          <GuideSection
            id="agents"
            number="03"
            title="Create and equip an agent"
            description="An agent is a reusable identity and policy. It is not a permanent process. A process starts only when chat, a task, Work coordination, or an automation creates a Run."
            icon={Bot}
          >
            <div className="grid gap-5 lg:grid-cols-[1fr_.9fr]">
              <ol className="rounded-lg border bg-card px-4">
                <Step number="01" title="Create the identity">
                  Go to{" "}
                  <strong className="text-foreground">
                    Agents → New agent
                  </strong>
                  . Enter a short name, business role, and stable instructions.
                  Instructions should define responsibility, judgment,
                  boundaries, and how the agent records results.
                </Step>
                <Step number="02" title="Choose runtime policy">
                  Choose a healthy enabled runtime and model. Codex is stable;
                  Claude Agent is experimental and requires a verified
                  Anthropic API key. Enabled agents can receive new work.
                  Disabled agents keep their history but do not start new runs.
                </Step>
                <Step number="03" title="Set Work and Docs access">
                  Guarded access auto-runs reads and asks before protected
                  writes. Full access lets the agent create and modify Work and
                  Docs without repeated MCP approvals. Local shell approvals
                  remain separate.
                </Step>
                <Step number="04" title="Assign capabilities">
                  Open the agent&apos;s{" "}
                  <strong className="text-foreground">Capabilities</strong> tab
                  and enable PostHog or custom integrations. Configure Email
                  account scope and read/draft/send policy from Settings →
                  Email.
                </Step>
                <Step
                  number="05"
                  title="Give it work"
                  result="The run receives a fixed capability snapshot"
                >
                  Use Chat for a continuing conversation, Give task for ad-hoc
                  execution, assign a Work item to the agent slug, or attach the
                  agent to an automation.
                </Step>
              </ol>
              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-sm font-semibold">What belongs where</p>
                  <dl className="mt-3 divide-y border-y">
                    <FieldRow
                      field="Role"
                      enter="Who the agent is accountable for being"
                    />
                    <FieldRow
                      field="Instructions"
                      enter="Stable decision rules and operating boundaries"
                    />
                    <FieldRow
                      field="Run policy"
                      enter="Why this execution started and how it should act now"
                    />
                    <FieldRow
                      field="Capabilities"
                      enter="The integrations available at run start"
                    />
                    <FieldRow
                      field="Work item"
                      enter="Operational scope for assignment/work_item runs"
                    />
                  </dl>
                </div>
                <Callout title="Do not put every workflow into the system prompt">
                  Chat, assignment, review, automation, and Work-event runs
                  carry separate execution semantics. Keep permanent
                  instructions about identity; keep the immediate objective in
                  the task, automation, or Work item.
                </Callout>
                <Callout title="Agent directory is automatic" icon={Users}>
                  Every enabled agent is added to the run-time directory with
                  its exact assignee slug, role, and safe capability summary.
                  New agents appear on the next run without maintaining a
                  second index. Delegation must use one of those exact slugs.
                </Callout>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" asChild>
                    <Link href="/agents">Create agent</Link>
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/automations">View automations</Link>
                  </Button>
                </div>
              </div>
            </div>
          </GuideSection>

          <GuideSection
            id="memory"
            number="04"
            title="Optional long-term memory"
            description="Honcho can retain operator preferences and corrections across chat threads. It is supporting context—not a source of operational truth—and every run continues if memory is unavailable."
            icon={BrainCircuit}
          >
            <div className="grid gap-5 lg:grid-cols-[1fr_.9fr]">
              <ol className="rounded-lg border bg-card px-4">
                <Step number="01" title="Choose a deployment">
                  The stack installer offers disabled, managed Honcho, or a
                  self-hosted Honcho profile. Existing workspaces remain
                  disabled until an operator opts in.
                </Step>
                <Step number="02" title="Configure the provider">
                  Open <strong className="text-foreground">Settings → Memory</strong>
                  . Set the Honcho URL, workspace ID, write-only API key when
                  required, and a bounded recall budget. Test the connection
                  before enabling regular use.
                </Step>
                <Step number="03" title="Recall at run start">
                  Slab requests a compact representation when the run reaches
                  the queue head. Recalled text is marked non-authoritative and
                  cannot override the current Work, Docs, Email, or API state.
                </Step>
                <Step
                  number="04"
                  title="Learn from operator chat"
                  result="Later runs can retrieve the relevant preference or correction"
                >
                  After a successful chat run, Slab sends only the
                  operator-authored message to Honcho. Agent responses, tool
                  payloads, automated Work events, and credentials are not
                  stored as memory input.
                </Step>
              </ol>
              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-sm font-semibold">Truth precedence</p>
                  <dl className="mt-3 divide-y border-y">
                    <FieldRow field="Work" enter="Current execution state and ownership" />
                    <FieldRow field="Docs" enter="Durable company knowledge" />
                    <FieldRow field="Integrations" enter="Current external facts" />
                    <FieldRow field="Memory" enter="Potentially relevant preferences and prior corrections" />
                  </dl>
                </div>
                <Callout title="Memory failure is non-blocking" icon={ShieldCheck}>
                  Honcho is called with a short timeout. An outage is recorded
                  in the run audit trail, injects no memory context, and never
                  prevents the runtime from starting.
                </Callout>
                <Callout title="Self-hosted still needs a model provider" icon={Cloud}>
                  The self-hosted profile keeps Honcho&apos;s database on your VPS,
                  but its derivation and embedding workers use the OpenAI API
                  key supplied during installation. Managed Honcho sends memory
                  input to the configured Honcho service.
                </Callout>
                <Button size="sm" variant="outline" asChild>
                  <Link href="/settings?tab=memory">Configure memory</Link>
                </Button>
              </div>
            </div>
          </GuideSection>

          <GuideSection
            id="tools"
            number="05"
            title="Create tools from an API or MCP server"
            description="Custom Integrations turns curated external capabilities into named agent tools. The model never receives a generic HTTP client and never chooses an arbitrary host or header."
            icon={Wrench}
          >
            <div className="grid gap-5 xl:grid-cols-2">
              <div className="rounded-lg border bg-card p-4 sm:p-5">
                <div className="flex items-center gap-2">
                  <Code2 className="size-4 text-primary" />
                  <h3 className="text-base font-semibold">
                    HTTP API from documentation
                  </h3>
                </div>
                <ol className="mt-4 border-y px-1">
                  <Step number="01" title="Start connector">
                    Open{" "}
                    <strong className="text-foreground">
                      Integrations → Custom integration → HTTP API
                    </strong>
                    .
                  </Step>
                  <Step number="02" title="Import or define">
                    Paste Markdown API documentation or a Slab JSON manifest to
                    create an unsaved draft, or add GET/HEAD operations
                    manually. Import never calls the upstream service.
                  </Step>
                  <Step number="03" title="Review the contract">
                    Confirm name, base URL, authentication type, operation
                    paths, path/query parameters, response path, timeout, byte
                    limit, and array item limit.
                  </Step>
                  <Step number="04" title="Enter the secret separately">
                    Choose None, Bearer, or API-key header. Never paste
                    credentials into the documentation importer. The secret
                    field is encrypted server-side and omitted from tool
                    definitions and profiling.
                  </Step>
                  <Step
                    number="05"
                    title="Save, test, and assign"
                    result="The next run sees semantic tools such as metrics__get_sales"
                  >
                    Test the connector, save it, then grant agent access from
                    the integration editor or the agent&apos;s Capabilities tab.
                  </Step>
                </ol>
              </div>

              <div className="rounded-lg border bg-card p-4 sm:p-5">
                <div className="flex items-center gap-2">
                  <Network className="size-4 text-primary" />
                  <h3 className="text-base font-semibold">
                    Existing MCP server
                  </h3>
                </div>
                <ol className="mt-4 border-y px-1">
                  <Step number="01" title="Choose MCP Server">
                    Enter the Streamable HTTP URL and optional Bearer or API-key
                    header authentication.
                  </Step>
                  <Step number="02" title="Discover tools">
                    Test performs initialize and tools/list. Slab Agents stores
                    names, descriptions, input schemas, and provider
                    annotations, never the auth secret in discovery metadata.
                  </Step>
                  <Step number="03" title="Review exposure">
                    Enable only the discovered tools the selected agent should
                    use. Provider annotations are useful context but are not
                    treated as security enforcement.
                  </Step>
                  <Step
                    number="04"
                    title="Refresh deliberately"
                    result="New runs receive the refreshed tool set"
                  >
                    Use Refresh tools after the remote server changes. Runs
                    already in progress keep their original capability version.
                  </Step>
                </ol>
              </div>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
              <div className="min-w-0">
                <p className="mb-2 text-sm font-semibold">
                  Example: curated metrics API
                </p>
                <CodeBlock>{`Integration: Clasificar Metrics
Base URL:   https://clasific.ar
Auth:       Bearer <CLASIFICAR_METRICS_SECRET>
Operation:  GET /api/admin/metrics/sales
Shape:      responsePath = data
Tool:       clasificar_metrics__get_metrics_sales`}</CodeBlock>
              </div>
              <Callout
                title="Use the reader credential, not the server pseudonym key"
                icon={KeyRound}
              >
                For the documented Agent Metrics API, the normal Bearer is the
                value of{" "}
                <code className="font-mono text-foreground">
                  CLASIFICAR_METRICS_SECRET
                </code>
                . The PII secret belongs in a separate, intentionally privileged
                connector. The pseudonym HMAC secret must never leave the API
                server.
              </Callout>
            </div>

            <Callout
              title="Capability snapshots are immutable during a run"
              icon={ShieldCheck}
            >
              Adding an operation, rotating a secret, enabling an integration,
              or granting access does not hot-plug tools into a running Codex
              context. Start a new run to receive the new capability version.
            </Callout>
            <Button className="mt-4" size="sm" asChild>
              <Link href="/integrations">
                <PlugZap /> Open Integrations
              </Link>
            </Button>
          </GuideSection>

          <GuideSection
            id="email"
            number="06"
            title="Email architecture and permissions"
            description="Email is optional and deliberately split: Slab Agents owns agent policy; slab-email owns mailbox credentials, provider tokens, and MCP execution."
            icon={Mail}
          >
            <div className="rounded-lg border bg-muted/20 p-4 sm:p-5">
              <div className="flex flex-col items-stretch lg:flex-row lg:items-center">
                <DiagramNode
                  label="Configuration"
                  title="Settings → Email"
                  detail="Connect providers, test mailboxes, and choose account scope plus read/draft/send policy per agent."
                  icon={Settings2}
                  className="lg:flex-1"
                />
                <FlowArrow label="server-side admin API" />
                <DiagramNode
                  label="Credential owner"
                  title="slab-email"
                  detail="Encrypts OAuth client secrets, refresh tokens, mailbox passwords, provider API keys, and scoped connector tokens."
                  icon={LockKeyhole}
                  tone="accent"
                  className="lg:flex-1"
                />
                <FlowArrow label="run-scoped MCP" />
                <DiagramNode
                  label="Runtime"
                  title="Agent tools"
                  detail="Search, read, draft, reply, and send are visible only when the profile grants them."
                  icon={Bot}
                  tone="dark"
                  className="lg:flex-1"
                />
              </div>
            </div>
            <div className="mt-5 grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 xl:grid-cols-3">
              {[
                [
                  "Gmail",
                  "Full mailbox through the Gmail API and Google OAuth.",
                ],
                [
                  "Microsoft 365",
                  "Full mailbox through Microsoft Graph and OAuth.",
                ],
                [
                  "Proton Mail",
                  "Full mailbox through managed or external Proton Bridge.",
                ],
                [
                  "IMAP / SMTP",
                  "Universal mailbox access using provider app credentials.",
                ],
                [
                  "AgentMail",
                  "Agent-native inboxes with search, threads, drafts, send, and reply.",
                ],
                [
                  "Resend",
                  "Transactional send with optional inbound reading; no fake drafts or threads.",
                ],
              ].map(([title, detail]) => (
                <div key={title} className="bg-card p-4">
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {detail}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-5 grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
              {[
                ["Disabled", "No send capability is issued to the agent."],
                [
                  "Approval required",
                  "Send/reply pauses the Run for a human decision.",
                ],
                [
                  "Autonomous",
                  "The scoped profile can send without another Slab approval.",
                ],
              ].map(([title, detail]) => (
                <div key={title} className="bg-card p-4">
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {detail}
                  </p>
                </div>
              ))}
            </div>
            <Callout title="Connecting a mailbox is not enough" tone="warning">
              After the provider test succeeds, assign one or more accounts to
              an agent and choose read, draft, and send permissions. A connected
              mailbox with no agent access profile produces no Email tools.
            </Callout>
            <Callout title="Choose the provider that matches the job">
              Use Gmail, Microsoft, Proton, or IMAP/SMTP for a human mailbox.
              Use AgentMail when an agent should own a dedicated inbox. Use
              Resend for application delivery and inbound events. Nylas can be
              connected later through Custom MCP/API when a unified third-party
              mailbox aggregator is preferable to a native provider.
            </Callout>
          </GuideSection>

          <GuideSection
            id="gmail"
            number="07"
            title="Connect Gmail with Google OAuth"
            description="Gmail uses the official Gmail API and OAuth 2.0. You create the OAuth client in Google Cloud, save it in Settings, and explicitly add test users while the app remains in Testing."
            icon={Cloud}
          >
            <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
              <ol className="rounded-lg border bg-card px-4">
                <Step number="01" title="Create a Google Cloud project">
                  Open Google Cloud Console, select or create the project that
                  will own this integration, and make sure billing/organization
                  policy does not prevent OAuth client creation.
                </Step>
                <Step number="02" title="Enable Gmail API">
                  Go to{" "}
                  <strong className="text-foreground">
                    APIs & Services → Library
                  </strong>
                  , search for{" "}
                  <strong className="text-foreground">Gmail API</strong>, and
                  enable it for this project.
                </Step>
                <Step number="03" title="Configure Google Auth Platform">
                  Open{" "}
                  <strong className="text-foreground">
                    Google Auth Platform
                  </strong>
                  . Under Branding, enter an app name, support email, and
                  developer contact. Under Audience, choose External unless your
                  Workspace organization intentionally requires Internal.
                </Step>
                <Step number="04" title="Add scopes">
                  Under Data Access, add Gmail readonly, compose, and send. Slab
                  Email requests these scopes so profiles can independently
                  expose read, draft, and send tools.
                </Step>
                <Step number="05" title="Add testing accounts">
                  While publishing status is{" "}
                  <strong className="text-foreground">Testing</strong>, open
                  Audience → Test users and add every Google account that may
                  complete the connection. The Gmail address you select during
                  OAuth must be in this list.
                </Step>
                <Step number="06" title="Create OAuth client">
                  Go to Clients → Create client → Web application. You do not
                  need a JavaScript origin for this server-side flow.
                </Step>
                <Step number="07" title="Register the exact callback">
                  In Slab Agents, open Settings → Email → Configure email and
                  copy the Authorized redirect URI exactly. Paste it into
                  Google&apos;s Authorized redirect URIs. It must use your real
                  HTTPS domain.
                </Step>
                <Step number="08" title="Save credentials in Slab">
                  Copy the Google client ID and client secret into the Google
                  OAuth section, then select Save OAuth credentials. The secret
                  is sent server-to-server to slab-email and stored encrypted.
                </Step>
                <Step
                  number="09"
                  title="Connect and test"
                  result="The Gmail mailbox appears as Enabled and Connected"
                >
                  Select Connect Gmail, choose a test user, approve the
                  requested scopes, return to Slab, and run Test on the new
                  mailbox.
                </Step>
                <Step number="10" title="Assign the mailbox">
                  In Agent access profiles, select the agent, allowed account,
                  read/draft/send permissions, and send policy. Start a new run
                  to make Email tools available.
                </Step>
              </ol>

              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-sm font-semibold">
                    Google configuration map
                  </p>
                  <dl className="mt-3 divide-y border-y">
                    <FieldRow field="API" enter="Gmail API" />
                    <FieldRow field="Client type" enter="Web application" />
                    <FieldRow
                      field="Audience"
                      enter="External → Testing for initial setup"
                    />
                    <FieldRow
                      field="Test users"
                      enter="Every Gmail/Workspace account that will connect"
                    />
                    <FieldRow
                      field="Redirect URI"
                      enter="Copy the exact HTTPS callback displayed by Slab Agents"
                    />
                    <FieldRow
                      field="Scopes"
                      enter="gmail.readonly, gmail.compose, gmail.send"
                    />
                  </dl>
                </div>
                <Callout
                  title="Correct redirect URI"
                  tone="success"
                  icon={Check}
                >
                  Use:
                  <code className="mt-2 block break-all font-mono text-foreground">
                    https://&lt;your-domain&gt;/api/integrations/email/google/callback
                  </code>
                </Callout>
                <Callout title="Never register 0.0.0.0" tone="warning">
                  <code className="font-mono text-foreground">0.0.0.0</code> is
                  a server bind address, not a browser origin. Google will
                  reject it. On a domain deployment, do not register localhost,
                  the private slab-email callback, or an IP callback instead of
                  the exact URL shown in Settings.
                </Callout>
                <div className="rounded-lg border bg-card p-4">
                  <p className="text-sm font-semibold">What is stored</p>
                  <ul className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
                    <li>
                      • Client ID and encrypted client secret in slab-email.
                    </li>
                    <li>• Encrypted Gmail refresh token in slab-email.</li>
                    <li>• Account/profile/token metadata in Slab Agents.</li>
                    <li>
                      • No Google secret or refresh token in React or agent
                      prompts.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </GuideSection>

          <GuideSection
            id="proton"
            number="08"
            title="Connect Proton with managed Bridge"
            description="On supported self-hosted images, Proton Bridge is already built into slab-email. You do not install a second service: connect your Proton account and let slab-email manage the private Bridge lifecycle."
            icon={KeyRound}
          >
            <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
              <ol className="rounded-lg border bg-card px-4">
                <Step number="01" title="Check the requirement">
                  Proton Bridge requires a paid Proton plan. Managed Bridge is
                  available on the supported amd64 and arm64 self-hosted images.
                </Step>
                <Step number="02" title="Open Proton setup">
                  Go to{" "}
                  <strong className="text-foreground">
                    Settings → Email → Configure email → Proton Bridge
                  </strong>
                  . If the panel reports Managed Proton Bridge available, keep
                  the default managed mode.
                </Step>
                <Step number="03" title="Enter account identity">
                  Enter your full Proton email address, a display name that
                  agents will recognize, and your normal Proton account
                  password. This is not the generated Bridge mailbox password.
                </Step>
                <Step number="04" title="Complete the challenge">
                  Select Connect account. If Proton requires TOTP, mailbox
                  password, or human verification, the panel displays the next
                  required step. Complete it and select Continue.
                </Step>
                <Step number="05" title="Understand credential handling">
                  The Proton login password and challenge values are sent
                  directly to Bridge through private process pipes and are not
                  stored. Only the generated IMAP/SMTP mailbox credential is
                  encrypted at rest.
                </Step>
                <Step
                  number="06"
                  title="Test the mailbox"
                  result="Mailbox status reports Connected"
                >
                  The account appears in Mailboxes. Select Test before granting
                  it to an agent.
                </Step>
                <Step number="07" title="Assign agent access">
                  Choose allowed accounts, read/draft/send permissions, and send
                  policy in Agent access profiles. Start a new run after saving.
                </Step>
              </ol>

              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-sm font-semibold">
                    What to type in managed mode
                  </p>
                  <dl className="mt-3 divide-y border-y">
                    <FieldRow
                      field="Proton email"
                      enter="Your complete Proton mailbox address"
                    />
                    <FieldRow
                      field="Display name"
                      enter="The human-readable mailbox label agents will see"
                    />
                    <FieldRow
                      field="Proton password"
                      enter="Your normal Proton account password; used once for login"
                    />
                    <FieldRow
                      field="Two-factor code"
                      enter="Current TOTP code, only when Proton asks for it"
                    />
                    <FieldRow
                      field="Mailbox password"
                      enter="Additional mailbox password, only when the account uses one"
                    />
                  </dl>
                </div>
                <Callout title="CLI alternative" icon={TerminalSquare}>
                  The same managed flow is available on the VPS:
                  <code className="mt-2 block font-mono text-foreground">
                    sudo slabctl proton setup
                  </code>
                  Input is hidden. Type the password once and press Enter; do
                  not repeatedly submit empty lines while Bridge is processing.
                </Callout>
                <Callout
                  title="Manual Bridge is a different mode"
                  tone="warning"
                >
                  Use “Connect an existing Bridge” only when Bridge already runs
                  on a host reachable from slab-email. Enter the generated
                  Bridge username/password plus its IMAP/SMTP host, ports, and
                  TLS modes. A Bridge on your laptop is not reachable from a
                  remote VPS.
                </Callout>
              </div>
            </div>

            <div className="mt-5 rounded-lg border p-4 sm:p-5">
              <p className="text-sm font-semibold">
                Manual Bridge field reference
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                These values come from Proton Bridge connection settings, not
                from your Proton account login screen.
              </p>
              <dl className="mt-4 grid gap-x-6 border-y lg:grid-cols-2">
                <FieldRow
                  field="Email address"
                  enter="Mailbox address exposed by Bridge"
                />
                <FieldRow field="Display name" enter="Label shown in Slab" />
                <FieldRow
                  field="Bridge username"
                  enter="Generated Bridge username"
                />
                <FieldRow
                  field="Bridge password"
                  enter="Generated Bridge password"
                />
                <FieldRow
                  field="IMAP host/port"
                  enter="Reachable Bridge IMAP endpoint"
                />
                <FieldRow
                  field="IMAP TLS"
                  enter="Match Bridge: SSL, STARTTLS, or none"
                />
                <FieldRow
                  field="SMTP host/port"
                  enter="Reachable Bridge SMTP endpoint"
                />
                <FieldRow
                  field="SMTP TLS"
                  enter="Match Bridge: SSL, STARTTLS, or none"
                />
              </dl>
            </div>
          </GuideSection>

          <GuideSection
            id="calendar"
            number="09"
            title="Connect calendars"
            description="Calendar is an optional Slab Agents capability. Provider credentials stay encrypted in the control plane; agents receive only semantic, account-scoped tools through an opaque run token."
            icon={CalendarDays}
          >
            <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
              <div className="rounded-lg border bg-card p-4 sm:p-5">
                <p className="text-sm font-semibold">Provider map</p>
                <div className="mt-3 divide-y border-y">
                  {[
                    [
                      "Google Calendar",
                      "OAuth · calendars, events, free/busy, create, update, cancel",
                    ],
                    [
                      "Microsoft 365",
                      "OAuth · Outlook calendars through Microsoft Graph",
                    ],
                    [
                      "CalDAV",
                      "App password · Nextcloud, Fastmail, iCloud, Radicale, and compatible servers",
                    ],
                    [
                      "Cal.com",
                      "API key · bookings, period lookup, reschedule, and cancel",
                    ],
                    [
                      "Shared calendar URL",
                      "Private ICS link · read-only, including Proton Calendar shared links",
                    ],
                  ].map(([provider, detail]) => (
                    <div
                      key={provider}
                      className="grid gap-1 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4"
                    >
                      <strong className="text-sm">{provider}</strong>
                      <span className="text-xs leading-5 text-muted-foreground">
                        {detail}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-4">
                <Callout
                  title="Write policy defaults to approval"
                  icon={ShieldCheck}
                >
                  Every writable account starts as Approval required. Disabled
                  exposes only read tools. Autonomous allows writes without a
                  runtime prompt. Shared ICS is always read-only.
                </Callout>
                <Callout
                  title="Capabilities are run snapshots"
                  icon={LockKeyhole}
                >
                  Assigning an account, changing its policy, or reconnecting it
                  affects the next run. Existing runs never hot-plug new
                  calendar access and fail closed if the integration version
                  changes.
                </Callout>
              </div>
            </div>

            <div className="mt-5 rounded-lg border bg-card px-4">
              <ol>
                <Step number="01" title="Open Calendar settings">
                  Go to{" "}
                  <strong className="text-foreground">
                    Settings → Calendar
                  </strong>
                  , select Configure calendar, and choose one provider.
                </Step>
                <Step number="02" title="Connect the account">
                  Enter only the provider configuration requested by the form.
                  Secrets are sent to the server, encrypted locally, and never
                  returned to React, prompts, schemas, run events, or profiling.
                </Step>
                <Step number="03" title="Choose write policy">
                  Keep Approval required for the first test. Use Disabled for
                  discovery-only agents. Enable Autonomous only for an account
                  whose events the agent is explicitly allowed to modify.
                </Step>
                <Step number="04" title="Assign agents">
                  Enable the account for the agents that need it. The next run
                  receives only that account&apos;s allowed calendar tools.
                </Step>
                <Step
                  number="05"
                  title="Test a fresh run"
                  result="Run capability snapshot lists the calendar integration and semantic tools"
                >
                  Ask the agent to list calendars, inspect a narrow date range,
                  and find availability. Test a write only after confirming the
                  selected calendar, time zone, attendees, and approval policy.
                </Step>
              </ol>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <div className="rounded-lg border bg-card p-4 sm:p-5">
                <p className="text-sm font-semibold">Google Calendar OAuth</p>
                <ol className="mt-3 border-y px-1">
                  <Step number="01" title="Enable the API">
                    In Google Cloud, enable{" "}
                    <strong className="text-foreground">
                      Google Calendar API
                    </strong>
                    .
                  </Step>
                  <Step number="02" title="Configure consent">
                    Use Google Auth Platform to configure Branding and Audience.
                    While the app is Testing, add every connecting account under
                    Test users.
                  </Step>
                  <Step number="03" title="Create a Web client">
                    Create an OAuth client of type Web application. Copy the
                    client ID and secret into Slab Agents.
                  </Step>
                  <Step number="04" title="Register the callback">
                    Add the exact HTTPS redirect URI shown by the Calendar form:
                    <code className="mt-2 block break-all font-mono text-foreground">
                      https://&lt;your-domain&gt;/api/integrations/calendar/google/callback
                    </code>
                  </Step>
                  <Step number="05" title="Authorize">
                    Save the configuration, select Authorize account, choose a
                    configured test user, approve access, and return to
                    Settings.
                  </Step>
                </ol>
              </div>

              <div className="rounded-lg border bg-card p-4 sm:p-5">
                <p className="text-sm font-semibold">Microsoft 365 OAuth</p>
                <ol className="mt-3 border-y px-1">
                  <Step number="01" title="Register an Entra application">
                    In Microsoft Entra admin center, create an App registration
                    for the intended tenant. Use{" "}
                    <code className="font-mono text-foreground">common</code>
                    only when multi-tenant or personal-account login is
                    deliberate.
                  </Step>
                  <Step number="02" title="Add delegated permissions">
                    Add User.Read, offline_access, and Calendars.ReadWrite, then
                    grant consent according to the organization&apos;s policy.
                  </Step>
                  <Step number="03" title="Create a client secret">
                    Copy the application client ID and the new secret value into
                    Slab Agents. The secret value is shown only once by Entra.
                  </Step>
                  <Step number="04" title="Register the callback">
                    Add:
                    <code className="mt-2 block break-all font-mono text-foreground">
                      https://&lt;your-domain&gt;/api/integrations/calendar/microsoft/callback
                    </code>
                  </Step>
                  <Step number="05" title="Authorize and test">
                    Save, select Authorize account, complete Microsoft consent,
                    then run Test from the account row.
                  </Step>
                </ol>
              </div>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-3">
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-sm font-semibold">CalDAV</p>
                <dl className="mt-3 divide-y border-y">
                  <FieldRow
                    field="URL"
                    enter="Exact account/calendar collection URL from the provider"
                  />
                  <FieldRow
                    field="Username"
                    enter="CalDAV login or provider-specific username"
                  />
                  <FieldRow
                    field="Password"
                    enter="Prefer a dedicated app password"
                  />
                </dl>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-sm font-semibold">Cal.com</p>
                <dl className="mt-3 divide-y border-y">
                  <FieldRow
                    field="API URL"
                    enter="https://api.cal.com unless self-hosted"
                  />
                  <FieldRow field="API key" enter="A dedicated cal_ API key" />
                  <FieldRow
                    field="Event type ID"
                    enter="Required only for creating bookings"
                  />
                </dl>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-sm font-semibold">Proton / private ICS</p>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  In Proton Calendar web, open Settings → All settings →
                  Calendars, choose a calendar, and create a Share with anyone
                  link. Paste that private link into Shared calendar URL. Proton
                  does not currently provide CalDAV, so this path is read-only.
                  A full-view link exposes event details to anyone holding the
                  URL; store and rotate it like a password.
                </p>
              </div>
            </div>

            <Callout title="Semantic tool surface" tone="success" icon={Check}>
              Agents see calendar_list_calendars, calendar_list_events,
              calendar_get_event, calendar_find_availability, and—only when the
              provider and policy allow it—calendar_create_event,
              calendar_update_event, and calendar_cancel_event. They never see
              OAuth tokens, CalDAV passwords, API keys, private feed URLs, raw
              headers, or a generic HTTP client.
            </Callout>
          </GuideSection>

          <GuideSection
            id="runs"
            number="10"
            title="From intent to auditable run"
            description="Every execution is durable and typed. Agent identity, trigger, execution mode, optional Work scope, run policy, capabilities, and runtime continuity are separate concepts."
            icon={Activity}
          >
            <div className="flex flex-col items-stretch lg:flex-row lg:items-center">
              <DiagramNode
                label="Intent"
                title="Human or event"
                detail="Chat message, manual task, automation, assignment, blocker, review request, resume, or mention."
                icon={Play}
                className="lg:flex-1"
              />
              <FlowArrow label="creates" />
              <DiagramNode
                label="Control plane"
                title="Queued Run"
                detail="Persists trigger, mode, issue scope, policy, agent, and capability snapshot; FIFO per agent."
                icon={ListChecks}
                tone="accent"
                className="lg:flex-1"
              />
              <FlowArrow label="executes" />
              <DiagramNode
                label="Runtime"
                title="Codex + tools"
                detail="Streams model calls, tool lifecycle, approvals, usage, and final assistant output."
                icon={TerminalSquare}
                tone="dark"
                className="lg:flex-1"
              />
              <FlowArrow label="records" />
              <DiagramNode
                label="Audit"
                title="Run detail"
                detail="Status, duration, context profile, tool breakdown, timeline, errors, and runtime thread."
                icon={Gauge}
                tone="success"
                className="lg:flex-1"
              />
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <div className="min-w-0 rounded-lg border bg-card p-4">
                <p className="text-sm font-semibold">Chat continuity</p>
                <CodeBlock>{`chat message A
→ product thread
→ runtime thread X created

chat message B
→ same product thread
→ runtime thread X resumed`}</CodeBlock>
              </div>
              <div className="min-w-0 rounded-lg border bg-card p-4">
                <p className="text-sm font-semibold">
                  Fresh non-chat execution
                </p>
                <CodeBlock>{`assignment / review / work_item / task
→ product grouping preserved
→ fresh runtime thread per Run
→ Work + Docs remain the source of continuity`}</CodeBlock>
              </div>
            </div>

            <div className="mt-5 grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["Chat", "Conversation is primary; runtime thread may resume."],
                ["Assignment", "One issue is the deliberate operating scope."],
                [
                  "Review",
                  "No arbitrary issue; inspect company state and decide.",
                ],
                [
                  "Automation",
                  "Schedule is the trigger; mode defines behavior.",
                ],
              ].map(([title, detail]) => (
                <div key={title} className="bg-card p-4">
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {detail}
                  </p>
                </div>
              ))}
            </div>

            <Callout
              title="Concurrency stays safe without a global lock"
              icon={RefreshCw}
            >
              Runs are FIFO with at most one active execution per agent, while
              different agents can work in parallel. Work-triggered runs are
              revalidated immediately before Runner starts; stale triggers are
              persisted as skipped with zero model usage. Issue writes use
              optimistic version checks, so stale state cannot overwrite newer
              work.
            </Callout>
          </GuideSection>

          <GuideSection
            id="troubleshooting"
            number="11"
            title="Troubleshooting"
            description="Start with the visible status and test action closest to the failing boundary. Do not compensate for a missing capability by expanding an agent prompt."
            icon={TestTube2}
          >
            <div className="rounded-lg border bg-card px-4">
              <TroubleshootingItem
                title="Gmail says Missing OAuth credentials"
                symptom="INVALID_CONFIGURATION · Missing Google OAuth credentials"
              >
                Open Settings → Email → Configure email. Enter the Web
                application client ID and client secret from Google Cloud,
                select Save OAuth credentials, then use Connect Gmail. Creating
                a Google project alone does not configure slab-email.
              </TroubleshootingItem>
              <TroubleshootingItem
                title="Google rejects the redirect URI"
                symptom="Error 400: invalid_request or redirect_uri_mismatch"
              >
                Copy the Authorized redirect URI shown by Slab Agents and
                register the exact value in the OAuth client. Scheme, host,
                port, path, and trailing slash must match. Never use 0.0.0.0.
                For a domain install, use the HTTPS domain callback.
              </TroubleshootingItem>
              <TroubleshootingItem
                title="Google blocks the selected account"
                symptom="Access denied while the OAuth app is in Testing"
              >
                Open Google Auth Platform → Audience → Test users and add the
                exact Google account selected during OAuth. Wait briefly for the
                change, then restart Connect Gmail.
              </TroubleshootingItem>
              <TroubleshootingItem
                title="Gmail connects but the agent sees no Email tools"
                symptom="Mailbox test passes; agent says Email is unavailable"
              >
                Create or update the agent access profile in Settings → Email.
                Select the mailbox and permissions. Confirm send policy. Then
                start a new run because capabilities are snapshotted at run
                start.
              </TroubleshootingItem>
              <TroubleshootingItem
                title="Managed Proton rejects the login"
                symptom="Proton rejected the account login"
              >
                In managed mode, enter the normal Proton account password, not
                the generated Bridge password copied from another machine.
                Confirm the account has a paid plan and complete any TOTP,
                mailbox-password, or human-verification challenge shown by the
                panel.
              </TroubleshootingItem>
              <TroubleshootingItem
                title="Calendar OAuth returns redirect_uri_mismatch"
                symptom="Google or Microsoft rejects the calendar callback"
              >
                Register the exact HTTPS callback shown in Settings → Calendar.
                Calendar and Email use different callback paths. Do not reuse
                the Gmail callback, localhost, 0.0.0.0, or a private container
                address for a public domain installation.
              </TroubleshootingItem>
              <TroubleshootingItem
                title="Calendar connects but the agent sees no tools"
                symptom="Test is healthy; calendar_list_events is unavailable"
              >
                Open Settings → Calendar, edit the account, and enable that
                agent under Agent access. Then start a new run. Capabilities are
                immutable snapshots and are never inserted into an active run.
              </TroubleshootingItem>
              <TroubleshootingItem
                title="A Proton calendar cannot create events"
                symptom="Only list, get, and availability tools are exposed"
              >
                This is expected. Proton does not currently support CalDAV; its
                shared link is a private, read-only ICS feed. Use Google,
                Microsoft, CalDAV, or Cal.com for supported write operations.
              </TroubleshootingItem>
              <TroubleshootingItem
                title="Manual Proton Bridge times out or refuses connection"
                symptom="ECONNREFUSED, timeout, or 127.0.0.1:1143 unavailable"
              >
                Loopback is local to the slab-email container. A Bridge running
                on Windows or a laptop is not reachable from a remote VPS
                through its own 127.0.0.1. Prefer managed Bridge on the VPS. If
                you intentionally use an external Bridge, provide a host
                reachable from the container and match Bridge&apos;s IMAP/SMTP
                TLS settings exactly.
              </TroubleshootingItem>
              <TroubleshootingItem
                title="A custom tool does not appear"
                symptom="Integration is connected but the agent cannot call it"
              >
                Confirm the integration is enabled and healthy, grant the agent
                access to the integration/tools, then start a new run. Refresh
                MCP discovery if the provider changed its tools. Active runs
                never receive hot-plugged capabilities.
              </TroubleshootingItem>
              <TroubleshootingItem
                title="A run waits for approval"
                symptom="Run status is waiting_approval"
              >
                Open the waiting item or Run detail and approve or deny the
                exact action. Work/Docs full access does not automatically
                approve shell commands. Email send policy is enforced separately
                from Work/Docs access.
              </TroubleshootingItem>
              <TroubleshootingItem
                title="A Work-triggered run was skipped"
                symptom="Status: skipped · stale_trigger"
              >
                This is expected when the issue changed while the run waited in
                the per-agent queue. The preflight found that assignment,
                blocked, review, or resume state was no longer current and
                avoided spending runtime tokens.
              </TroubleshootingItem>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                [Settings2, "Connection problem", "Settings → Test connection"],
                [Activity, "Runtime problem", "Runs → Timeline / Debug"],
                [PlugZap, "Missing tool", "Integrations → Test / Agent access"],
                [Mail, "Mailbox problem", "Settings → Email → Test"],
              ].map(([IconComponent, title, action]) => (
                <div
                  key={title as string}
                  className="rounded-lg border bg-card p-4"
                >
                  <IconComponent className="size-4 text-primary" />
                  <p className="mt-4 text-sm font-semibold">
                    {title as string}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {action as string}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-8 rounded-lg border border-sidebar-border bg-petrol-deep p-5 text-white sm:p-7">
              <ShieldCheck className="size-5 text-accent" />
              <h3 className="mt-5 max-w-3xl font-heading text-3xl font-[675] tracking-[-.04em] sm:text-4xl">
                Work is the operating ledger. Docs is durable knowledge. Tools
                add reach. Runs make every action inspectable.
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/65">
                Start small: connect the core, create one agent, give it the
                minimum capabilities required, run one real task, and inspect
                the result.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Button variant="secondary" asChild>
                  <Link href="/agents">
                    <Bot /> Create agent
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  className="border-background/30 bg-transparent text-background hover:bg-background hover:text-foreground"
                  asChild
                >
                  <Link href="/integrations">
                    <PlugZap /> Add integration
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  className="border-background/30 bg-transparent text-background hover:bg-background hover:text-foreground"
                  asChild
                >
                  <Link href="/runs">
                    <Activity /> Inspect runs
                  </Link>
                </Button>
              </div>
            </div>
          </GuideSection>
        </article>
      </div>
    </>
  );
}
