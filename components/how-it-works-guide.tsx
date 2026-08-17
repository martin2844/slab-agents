import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  BookOpenText,
  Bot,
  BrainCircuit,
  CalendarClock,
  Check,
  CircleDot,
  Clock3,
  Cloud,
  Code2,
  Database,
  FileText,
  FolderKanban,
  KeyRound,
  Laptop,
  LockKeyhole,
  MessageSquare,
  Network,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  UserRound,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const chapters = [
  ["01", "The system", "#system"],
  ["02", "Source of truth", "#truth"],
  ["03", "Get started", "#quickstart"],
  ["04", "Operating loop", "#operating-loop"],
  ["05", "Agents & threads", "#agents"],
  ["06", "Runs & approvals", "#runs"],
  ["07", "Automations", "#automations"],
  ["08", "Data & security", "#security"],
  ["09", "Failure modes", "#failures"],
  ["10", "MVP boundaries", "#boundaries"],
] as const;

type NodeTone = "default" | "primary" | "muted" | "dark";

function DiagramNode({
  eyebrow,
  title,
  detail,
  icon: Icon,
  tone = "default",
  className,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: NodeTone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative min-w-0 border p-4",
        tone === "primary" && "border-primary bg-primary text-primary-foreground",
        tone === "muted" && "bg-muted/70",
        tone === "dark" && "border-foreground bg-foreground text-background",
        tone === "default" && "bg-card",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <p
          className={cn(
            "text-[0.62rem] font-bold uppercase tracking-[.16em]",
            tone === "primary" || tone === "dark"
              ? "text-current opacity-70"
              : "text-muted-foreground",
          )}
        >
          {eyebrow}
        </p>
        <Icon className="size-4 shrink-0" />
      </div>
      <p className="mt-5 font-heading text-2xl font-semibold leading-tight">
        {title}
      </p>
      <p
        className={cn(
          "mt-2 text-xs leading-5",
          tone === "primary" || tone === "dark"
            ? "text-current opacity-75"
            : "text-muted-foreground",
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
      <ArrowDown className="size-5 lg:hidden" aria-hidden />
      <ArrowRight className="hidden size-5 lg:block" aria-hidden />
      {label && (
        <span className="font-mono text-[0.58rem] uppercase tracking-wider">
          {label}
        </span>
      )}
    </div>
  );
}

function SectionHeading({
  number,
  eyebrow,
  title,
  children,
}: {
  number: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <header className="grid gap-5 border-t-2 border-foreground pt-5 lg:grid-cols-[9rem_1fr]">
      <div>
        <span className="font-mono text-xs text-primary">{number}</span>
        <p className="mt-1 text-xs font-bold uppercase tracking-[.16em] text-muted-foreground">
          {eyebrow}
        </p>
      </div>
      <div className="max-w-4xl">
        <h2 className="font-heading text-[clamp(2.2rem,4vw,4rem)] font-semibold leading-[.95] tracking-[-.035em]">
          {title}
        </h2>
        <div className="mt-5 max-w-3xl text-[0.95rem] leading-7 text-muted-foreground">
          {children}
        </div>
      </div>
    </header>
  );
}

function Principle({
  label,
  owner,
  children,
}: {
  label: string;
  owner: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-3 border-t py-5 sm:grid-cols-[11rem_1fr]">
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <Badge variant="outline" className="mt-2">
          {owner}
        </Badge>
      </div>
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
        {children}
      </p>
    </div>
  );
}

function Step({
  number,
  title,
  description,
  result,
}: {
  number: string;
  title: string;
  description: string;
  result: string;
}) {
  return (
    <li className="grid gap-4 border-t py-6 md:grid-cols-[3rem_13rem_1fr_12rem] md:items-start">
      <span className="font-mono text-xs text-primary">{number}</span>
      <p className="font-heading text-xl font-semibold leading-tight">{title}</p>
      <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      <div className="flex items-start gap-2 text-xs font-semibold">
        <Check className="mt-0.5 size-4 shrink-0 text-emerald-700" />
        {result}
      </div>
    </li>
  );
}

function SequenceRow({
  number,
  actor,
  action,
  stored,
}: {
  number: string;
  actor: string;
  action: string;
  stored: string;
}) {
  return (
    <li className="grid gap-3 border-t py-4 sm:grid-cols-[2.5rem_9rem_1fr] lg:grid-cols-[2.5rem_9rem_1fr_13rem] lg:items-center">
      <span className="font-mono text-[0.65rem] text-primary">{number}</span>
      <p className="text-sm font-bold">{actor}</p>
      <p className="text-sm leading-6 text-muted-foreground">{action}</p>
      <p className="text-xs leading-5 text-muted-foreground sm:col-start-3 lg:col-start-auto">
        <span className="font-semibold text-foreground">Recorded:</span> {stored}
      </p>
    </li>
  );
}

export function HowItWorksGuide() {
  return (
    <>
      <PageHeader
        eyebrow="System field guide"
        title="How the Slab ecosystem works"
        description="A practical map of where work lives, where knowledge lives, how agents execute, what this local app remembers, and how to get from an empty workspace to a repeatable operating loop."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/settings">
                <Settings2 />
                Configure services
              </Link>
            </Button>
            <Button asChild>
              <Link href="/">
                <Play />
                Start a loop
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-10 xl:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="xl:sticky xl:top-24 xl:h-fit">
          <p className="text-xs font-bold uppercase tracking-[.16em] text-muted-foreground">
            In this guide
          </p>
          <nav className="mt-3 divide-y border-y" aria-label="Guide chapters">
            {chapters.map(([number, label, href]) => (
              <Link
                key={href}
                href={href}
                className="group flex items-center gap-3 py-2.5 text-sm"
              >
                <span className="font-mono text-[0.62rem] text-muted-foreground">
                  {number}
                </span>
                <span className="font-semibold group-hover:text-primary">
                  {label}
                </span>
              </Link>
            ))}
          </nav>
          <div className="mt-6 border-l-2 border-primary pl-4 text-xs leading-5 text-muted-foreground">
            The shortest version: Slab knows what to do, Slab Docs knows what
            the company knows, Next decides who acts and when, and Runner knows
            how to execute the agent.
          </div>
        </aside>

        <article className="min-w-0 space-y-28 pb-24">
          <section id="system" className="scroll-mt-24">
            <SectionHeading
              number="01"
              eyebrow="The system"
              title="Four products, one operating surface."
            >
              <p>
                Slab Agent Workspace is a local control plane. It unifies the
                human experience of Work, Docs, Agents, Automations, and Runs,
                but it does not absorb the responsibilities of the services
                behind those views.
              </p>
            </SectionHeading>

            <div className="mt-10 border bg-muted/25 p-4 sm:p-6">
              <p className="mb-5 text-xs font-bold uppercase tracking-[.16em] text-muted-foreground">
                Runtime architecture
              </p>
              <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
                <DiagramNode
                  eyebrow="Human surface"
                  title="Browser"
                  detail="Navigation, forms, Kanban, Docs, chat, approvals, and run history. No MCP credentials."
                  icon={Laptop}
                  tone="muted"
                />
                <div className="flex flex-col items-center text-muted-foreground">
                  <ArrowDown className="size-5 md:hidden" />
                  <ArrowRight className="hidden size-5 md:block" />
                  <span className="font-mono text-[0.58rem] uppercase tracking-wider">
                    HTTP
                  </span>
                </div>
                <DiagramNode
                  eyebrow="Control plane"
                  title="Next.js"
                  detail="Frontend, BFF, MCP adapters, persistence, scheduler, and Runner orchestration on localhost:3009."
                  icon={Workflow}
                  tone="primary"
                />
              </div>
              <div className="my-3 flex flex-col items-center text-muted-foreground">
                <ArrowDown className="size-5" />
                <span className="font-mono text-[0.58rem] uppercase tracking-wider">
                  server only
                </span>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                  <DiagramNode
                    eyebrow="Remote"
                    title="Slab Work"
                    detail="Projects, issues, status, priority, comments, relationships, and blockers via MCP / HTTP."
                    icon={FolderKanban}
                  />
                  <DiagramNode
                    eyebrow="Remote"
                    title="Slab Docs"
                    detail="Documents, hierarchy, Markdown, search, archive state, and revisions via MCP / HTTP."
                    icon={FileText}
                  />
                  <DiagramNode
                    eyebrow="Loopback"
                    title="Slab Runner"
                    detail="Starts Codex, resumes runtime threads, exposes tools, streams events, and handles approvals."
                    icon={TerminalSquare}
                    tone="dark"
                  />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-2">
                  <Cloud className="size-3.5" /> Remote truth
                </span>
                <span className="flex items-center gap-2">
                  <Laptop className="size-3.5" /> Local control
                </span>
                <span className="flex items-center gap-2">
                  <LockKeyhole className="size-3.5" /> Server-side credentials
                </span>
              </div>
            </div>

            <div className="mt-10 grid gap-px overflow-hidden border bg-border md:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  name: "Slab",
                  role: "What needs to happen",
                  detail: "The operational ledger. It owns work state and collaboration around execution.",
                  icon: FolderKanban,
                },
                {
                  name: "Slab Docs",
                  role: "What the company knows",
                  detail: "The knowledge base. It owns context, decisions, plans, standards, and historical documentation.",
                  icon: BookOpenText,
                },
                {
                  name: "Next.js",
                  role: "Who acts and when",
                  detail: "The control plane. It owns local agents, threads, runs, approvals, settings, and schedules.",
                  icon: Workflow,
                },
                {
                  name: "Runner",
                  role: "How the agent executes",
                  detail: "The execution bridge. It turns an agent definition and prompt into a live Codex run.",
                  icon: Code2,
                },
              ].map((item) => (
                <div key={item.name} className="bg-card p-5">
                  <item.icon className="size-4 text-primary" />
                  <p className="mt-7 text-xs font-bold uppercase tracking-[.14em] text-muted-foreground">
                    {item.name}
                  </p>
                  <p className="mt-2 font-heading text-2xl font-semibold leading-tight">
                    {item.role}
                  </p>
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    {item.detail}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section id="truth" className="scroll-mt-24">
            <SectionHeading
              number="02"
              eyebrow="Source of truth"
              title="The interface is unified. Ownership is not."
            >
              <p>
                Every screen has a clear owner behind it. The control plane may
                present and mutate remote data through an adapter, but it never
                becomes a shadow database for Work or Docs.
              </p>
            </SectionHeading>
            <div className="mt-10 border-y">
              <Principle label="Projects & issues" owner="Slab Work">
                Projects, issue descriptions, assignees, priorities, states,
                comments, links, and blockers remain in Slab. Moving a Kanban
                card invokes WorkClient, which invokes the remote MCP tool.
              </Principle>
              <Principle label="Documents" owner="Slab Docs">
                Markdown bodies, hierarchy, tags, archived state, and revisions
                remain in Slab Docs. The editor writes through DocsClient; no
                document mirror is created locally.
              </Principle>
              <Principle label="Agents" owner="Next.js + SQLite">
                Agent identity, role, instructions, runtime, model, enabled
                state, and Work/Docs access policy are local orchestration
                resources. Creating an agent does not start a background
                process.
              </Principle>
              <Principle label="Conversation" owner="Next.js + Runner">
                Product messages and thread metadata are durable in SQLite. The
                runtime thread lives in Codex and is referenced through
                runtime_thread_id so the conversation can resume.
              </Principle>
              <Principle label="Execution" owner="Next.js + Runner">
                Next creates the durable Run record. Runner owns the live Codex
                process and emits the event stream that advances that Run.
              </Principle>
              <Principle label="Schedule" owner="Next.js + SQLite">
                Cron definitions and their local scheduler state live here. They
                fire only while this local application is running.
              </Principle>
            </div>

            <div className="mt-8 grid gap-6 border border-primary/30 bg-primary/5 p-5 md:grid-cols-[auto_1fr]">
              <ShieldCheck className="size-6 text-primary" />
              <div>
                <p className="font-heading text-2xl font-semibold">
                  The anti-copy rule
                </p>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                  If Work or Docs is unavailable, this app shows that source as
                  unavailable. It does not silently serve stale local replicas.
                  That keeps ownership legible and prevents two competing
                  versions of company reality.
                </p>
              </div>
            </div>
          </section>

          <section id="quickstart" className="scroll-mt-24">
            <SectionHeading
              number="03"
              eyebrow="Get started"
              title="From zero to a working operating loop."
            >
              <p>
                The shortest useful path is connection → verification → agent →
                task → approval → result. You can complete it entirely from the
                local workspace.
              </p>
            </SectionHeading>
            <ol className="mt-10 border-b">
              <Step
                number="01"
                title="Open Settings"
                description="Enter the remote Slab MCP URL and API key, the remote Slab Docs MCP URL and API key, and the loopback Runner URL. Secrets are submitted to Next and are never returned to React."
                result="Three endpoints configured"
              />
              <Step
                number="02"
                title="Run setup check"
                description="The backend opens each MCP connection, lists available tools, checks Runner health, and asks Runner whether the Codex runtime is available. Results and timestamps are stored locally."
                result="Four green checks"
              />
              <Step
                number="03"
                title="Confirm COO"
                description="Use the existing COO agent or create one. An agent is a reusable definition: name, role, instructions, runtime, model, enabled state, and guarded or full Work/Docs access—not a permanently running process."
                result="One enabled operator"
              />
              <Step
                number="04"
                title="Create operating loop"
                description="Choose Slab as Work, Slab Docs as Knowledge, COO as the operator, and start with a concrete prompt such as reviewing open work and summarizing next actions."
                result="Thread and Run created"
              />
              <Step
                number="05"
                title="Resolve approvals"
                description="Guarded agents auto-run reads and ask before Work/Docs writes. Full-access agents auto-run both. Local runtime commands and file permissions remain separately guarded."
                result="Execution continues safely"
              />
              <Step
                number="06"
                title="Keep the result"
                description="The completed assistant response is persisted as a normal message. Reloading the browser returns to the same product thread and retains the conversation."
                result="Durable first outcome"
              />
            </ol>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/">
                  <Play /> Run the first loop
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/settings">
                  <Settings2 /> Review connection settings
                </Link>
              </Button>
            </div>
          </section>

          <section id="operating-loop" className="scroll-mt-24">
            <SectionHeading
              number="04"
              eyebrow="Operating loop"
              title="A prompt becomes an auditable company action."
            >
              <p>
                The operating loop is the product&apos;s core unit of value. It
                joins a human intent, a durable local record, a runtime agent,
                and live company sources without flattening them into one
                system.
              </p>
            </SectionHeading>

            <div className="mt-10 overflow-hidden border">
              <div className="grid gap-px bg-border md:grid-cols-4">
                <DiagramNode
                  eyebrow="Intent"
                  title="Human asks"
                  detail="A specific desired outcome: review, summarize, identify, draft, or update."
                  icon={UserRound}
                  className="border-0"
                />
                <DiagramNode
                  eyebrow="Control"
                  title="Next records"
                  detail="Creates the product thread, user message, queued Run, and execution context."
                  icon={Database}
                  tone="muted"
                  className="border-0"
                />
                <DiagramNode
                  eyebrow="Execution"
                  title="Codex works"
                  detail="Runner starts or resumes Codex with Work and Docs tools available."
                  icon={BrainCircuit}
                  tone="dark"
                  className="border-0"
                />
                <DiagramNode
                  eyebrow="Outcome"
                  title="Thread persists"
                  detail="The answer, run status, usage, tool events, and approvals remain inspectable."
                  icon={MessageSquare}
                  tone="primary"
                  className="border-0"
                />
              </div>
            </div>

            <ol className="mt-8 border-b">
              <SequenceRow
                number="01"
                actor="Browser"
                action="Submits a message to the Next.js chat or operating-loop route."
                stored="Nothing sensitive in the browser."
              />
              <SequenceRow
                number="02"
                actor="Next.js"
                action="Validates the request, finds the enabled agent, creates a thread when needed, creates a queued Run, and persists the user message."
                stored="thread, run, user message"
              />
              <SequenceRow
                number="03"
                actor="Runner"
                action="Receives agent identity, model selection, prompt, minimal conversation context, and server-side MCP configuration."
                stored="Runner execution ID"
              />
              <SequenceRow
                number="04"
                actor="Codex"
                action="Starts a new runtime thread or resumes the existing runtime_thread_id. It decides when Work or Docs tools are needed."
                stored="runtime_thread_id"
              />
              <SequenceRow
                number="05"
                actor="MCP tools"
                action="Read or mutate the authoritative Work and Docs services. Protected actions can pause the run for human approval."
                stored="important tool events only"
              />
              <SequenceRow
                number="06"
                actor="Next.js"
                action="Consumes Runner events, streams progressive assistant output, updates status, records approvals, and persists the final assistant message."
                stored="events, approval, message"
              />
              <SequenceRow
                number="07"
                actor="Browser"
                action="Shows the final result in the thread. A reload reads completed messages from SQLite instead of depending on the old stream."
                stored="durable conversation"
              />
            </ol>

            <div className="mt-8 grid gap-5 md:grid-cols-2">
              <div className="border-t-2 border-primary pt-5">
                <RotateCcw className="size-5 text-primary" />
                <h3 className="mt-4 font-heading text-2xl font-semibold">
                  Runtime continuity
                </h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  The first run begins with runtime_thread_id = null. Runner
                  returns the Codex thread identifier, and Next persists it.
                  Later messages resume that runtime thread.
                </p>
              </div>
              <div className="border-t-2 border-foreground pt-5">
                <RefreshCw className="size-5" />
                <h3 className="mt-4 font-heading text-2xl font-semibold">
                  Recovery when runtime state disappears
                </h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  If Runner reports THREAD_NOT_FOUND, the product conversation
                  is not discarded. Next clears the broken runtime reference,
                  creates a new Codex thread, and rehydrates a bounded slice of
                  user and assistant messages.
                </p>
              </div>
            </div>
          </section>

          <section id="agents" className="scroll-mt-24">
            <SectionHeading
              number="05"
              eyebrow="Agents & threads"
              title="An agent is identity. A thread is continuity."
            >
              <p>
                Agents are first-class control-plane resources, but they are not
                daemons. They wake up only for a user message, a manual run, or
                an automation.
              </p>
            </SectionHeading>
            <div className="mt-10 flex flex-col items-stretch lg:flex-row lg:items-center">
              <DiagramNode
                eyebrow="Reusable definition"
                title="Agent"
                detail="Name, slug, role, instructions, runtime, model, enabled state, and Work/Docs access policy."
                icon={Bot}
                tone="primary"
                className="lg:flex-1"
              />
              <FlowArrow label="has many" />
              <DiagramNode
                eyebrow="Product continuity"
                title="Thread"
                detail="Title, agent_id, runtime_thread_id, timestamps, and durable messages."
                icon={MessageSquare}
                className="lg:flex-1"
              />
              <FlowArrow label="creates" />
              <DiagramNode
                eyebrow="Execution attempt"
                title="Run"
                detail="Status, runtime, start/end time, errors, usage, events, and approvals."
                icon={Activity}
                tone="dark"
                className="lg:flex-1"
              />
            </div>
            <div className="mt-10 grid gap-8 lg:grid-cols-2">
              <div>
                <h3 className="font-heading text-3xl font-semibold">
                  Stable identity
                </h3>
                <div className="mt-4 border-y">
                  {[
                    ["Role", "The operating lens: COO, Sales, Finance, Product, or another function."],
                    ["Instructions", "Durable behavioral guidance applied to every execution."],
                    ["Runtime", "Codex in the MVP, with the model designed to expand later."],
                    ["Enabled", "A local safety switch that prevents new executions without deleting history."],
                  ].map(([label, detail]) => (
                    <div key={label} className="grid gap-2 border-t py-4 first:border-t-0 sm:grid-cols-[8rem_1fr]">
                      <strong className="text-sm">{label}</strong>
                      <span className="text-sm leading-6 text-muted-foreground">{detail}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="font-heading text-3xl font-semibold">
                  Available context
                </h3>
                <div className="mt-4 border-y">
                  {[
                    ["Conversation", "The persistent Codex thread, or bounded message rehydration when recovery is needed."],
                    ["Company knowledge", "Slab Docs tools, queried when the task needs policies, plans, OKRs, or historical context."],
                    ["Operational state", "Slab Work tools, queried when the task needs projects, issues, priorities, blockers, or comments."],
                    ["No memory service", "There is no Honcho, vector memory, or semantic memory layer in this MVP."],
                  ].map(([label, detail]) => (
                    <div key={label} className="grid gap-2 border-t py-4 first:border-t-0 sm:grid-cols-[9rem_1fr]">
                      <strong className="text-sm">{label}</strong>
                      <span className="text-sm leading-6 text-muted-foreground">{detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section id="runs" className="scroll-mt-24">
            <SectionHeading
              number="06"
              eyebrow="Runs & approvals"
              title="Execution is a state machine, not a spinner."
            >
              <p>
                Every attempt is a durable Run with a defined lifecycle.
                Relevant events are retained for debugging, while raw token
                deltas remain ephemeral.
              </p>
            </SectionHeading>

            <div className="mt-10 overflow-x-auto border-y py-6">
              <div className="flex min-w-[760px] items-center">
                {[
                  ["queued", Clock3, "Next accepted the job"],
                  ["running", Radio, "Runner is executing"],
                  ["waiting approval", ShieldCheck, "Human decision required"],
                  ["running", Radio, "Execution resumes"],
                  ["completed", Check, "Final message persisted"],
                ].map(([label, Icon, detail], index) => (
                  <div key={`${label}-${index}`} className="contents">
                    <div className="min-w-32 flex-1 text-center">
                      <span className="mx-auto grid size-10 place-items-center rounded-full bg-foreground text-background">
                        <Icon className="size-4" />
                      </span>
                      <p className="mt-3 text-xs font-bold uppercase tracking-wider">{label as string}</p>
                      <p className="mt-1 text-[0.65rem] text-muted-foreground">{detail as string}</p>
                    </div>
                    {index < 4 && <ArrowRight className="size-5 shrink-0 text-muted-foreground" />}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8 grid gap-px overflow-hidden border bg-border sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["run_started", "A queued Run has entered execution."],
                ["tool_started", "Codex began a meaningful Work, Docs, or local tool call."],
                ["tool_completed", "The tool returned or failed with inspectable output metadata."],
                ["approval_required", "Runner paused for a human decision."],
                ["assistant_message", "The final assistant body is ready to persist."],
                ["run_completed / failed", "The terminal outcome and error context are recorded."],
              ].map(([event, detail]) => (
                <div key={event} className="bg-card p-4">
                  <code className="font-mono text-xs font-semibold text-primary">{event}</code>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</p>
                </div>
              ))}
            </div>

            <div className="mt-10 border border-amber-700/25 bg-amber-500/10 p-5 sm:p-7">
              <div className="grid gap-5 md:grid-cols-[auto_1fr]">
                <AlertTriangle className="size-6 text-amber-800" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-[.16em] text-amber-900">
                    Approval lifecycle
                  </p>
                  <h3 className="mt-2 font-heading text-3xl font-semibold">
                    The agent pauses. The human decides.
                  </h3>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                    Runner emits approval.required with the proposed action. Next
                    persists a pending Approval and marks the Run as
                    waiting_approval. Approve or Deny is posted back to Runner.
                    The local record moves through resolving to approved or
                    denied, preventing duplicate decisions from racing each other.
                  </p>
                  <div className="mt-6 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                    <Badge variant="outline">Pending</Badge>
                    <ArrowRight className="hidden size-4 sm:block" />
                    <Badge variant="outline">Resolving</Badge>
                    <ArrowRight className="hidden size-4 sm:block" />
                    <Badge className="bg-emerald-700 text-white">Approved</Badge>
                    <span className="text-center text-xs text-muted-foreground">or</span>
                    <Badge variant="destructive">Denied</Badge>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section id="automations" className="scroll-mt-24">
            <SectionHeading
              number="07"
              eyebrow="Automations"
              title="A schedule is simply another way to create a Run."
            >
              <p>
                Manual and cron automations reuse the same execution pipeline as
                chat. The key difference is who supplies the prompt and when the
                Run is created.
              </p>
            </SectionHeading>
            <div className="mt-10 flex flex-col items-stretch lg:flex-row lg:items-center">
              <DiagramNode
                eyebrow="Definition"
                title="Automation"
                detail="Name, agent, cron expression or manual trigger, prompt, enabled state, and last run time."
                icon={CalendarClock}
                className="lg:flex-1"
              />
              <FlowArrow label="fires" />
              <DiagramNode
                eyebrow="Local scheduler"
                title="Next.js"
                detail="Checks due cron expressions while the application process is running."
                icon={Clock3}
                tone="primary"
                className="lg:flex-1"
              />
              <FlowArrow label="creates" />
              <DiagramNode
                eyebrow="Normal pipeline"
                title="Thread + Run"
                detail="A traceable conversation, persisted prompt, Runner execution, events, approvals, and final answer."
                icon={Zap}
                tone="dark"
                className="lg:flex-1"
              />
            </div>
            <div className="mt-8 grid gap-6 md:grid-cols-2">
              <div className="border-t-2 border-foreground pt-5">
                <h3 className="font-heading text-2xl font-semibold">Manual</h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  A human presses Run now. Useful for templates and repeatable
                  reviews that should remain deliberate.
                </p>
              </div>
              <div className="border-t-2 border-primary pt-5">
                <h3 className="font-heading text-2xl font-semibold">Cron</h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  The local scheduler evaluates the cron expression in the
                  computer&apos;s timezone. Weekly OKR review is the default starter
                  template.
                </p>
              </div>
            </div>
            <div className="mt-8 flex gap-3 border-l-2 border-primary bg-muted/45 p-5">
              <Laptop className="mt-0.5 size-5 shrink-0 text-primary" />
              <p className="text-sm leading-6 text-muted-foreground">
                <strong className="text-foreground">MVP limitation:</strong> cron
                jobs only fire while this Next.js application is running. There
                is no missed-job replay, durable queue, clustering, distributed
                lock, or remote scheduler yet.
              </p>
            </div>
            <Button className="mt-6" variant="outline" asChild>
              <Link href="/automations">
                <CalendarClock /> Create an automation
              </Link>
            </Button>
          </section>

          <section id="security" className="scroll-mt-24">
            <SectionHeading
              number="08"
              eyebrow="Data & security"
              title="The browser is a view, not a trust boundary."
            >
              <p>
                The application is single-user and local, but the separation
                between browser, Next server, loopback Runner, and remote MCP
                services is still explicit.
              </p>
            </SectionHeading>

            <div className="mt-10 border p-4 sm:p-6">
              <p className="mb-5 text-xs font-bold uppercase tracking-[.16em] text-muted-foreground">
                Credential boundary
              </p>
              <div className="grid gap-4 lg:grid-cols-[1fr_auto_1.2fr_auto_1fr] lg:items-stretch">
                <DiagramNode
                  eyebrow="Untrusted presentation"
                  title="React / Browser"
                  detail="Receives public URLs and key-configured booleans. Never receives MCP API keys or Runner tokens."
                  icon={Laptop}
                  tone="muted"
                />
                <FlowArrow label="app API" />
                <DiagramNode
                  eyebrow="Trusted local server"
                  title="Next Node runtime"
                  detail="Reads secrets from server-side settings, validates requests, opens MCP sessions, and signs Runner requests."
                  icon={KeyRound}
                  tone="primary"
                />
                <FlowArrow label="auth headers" />
                <div className="grid gap-3">
                  <DiagramNode
                    eyebrow="Remote"
                    title="MCP services"
                    detail="Bearer credentials are attached only by the server adapter."
                    icon={Cloud}
                  />
                  <DiagramNode
                    eyebrow="127.0.0.1 only"
                    title="Runner"
                    detail="Execution API stays on loopback and may use a separate local token."
                    icon={TerminalSquare}
                    tone="dark"
                  />
                </div>
              </div>
            </div>

            <div className="mt-10 grid gap-8 xl:grid-cols-2">
              <div>
                <h3 className="font-heading text-3xl font-semibold">
                  SQLite stores orchestration
                </h3>
                <div className="mt-4 divide-y border-y">
                  {[
                    "Connection configuration and check status",
                    "Agent definitions",
                    "Product threads and completed messages",
                    "Runs, usage, errors, and relevant run events",
                    "Approvals and their resolution state",
                    "Manual and cron automation definitions",
                  ].map((item) => (
                    <div key={item} className="flex gap-3 py-3 text-sm">
                      <Database className="mt-0.5 size-4 shrink-0 text-primary" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="font-heading text-3xl font-semibold">
                  SQLite does not replicate truth
                </h3>
                <div className="mt-4 divide-y border-y">
                  {[
                    "Slab projects",
                    "Slab issues or comments",
                    "Slab issue relationships",
                    "Slab Docs documents",
                    "Slab Docs hierarchy or revisions",
                    "A vector index or semantic memory store",
                  ].map((item) => (
                    <div key={item} className="flex gap-3 py-3 text-sm text-muted-foreground">
                      <X className="mt-0.5 size-4 shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-8 grid gap-px overflow-hidden border bg-border sm:grid-cols-3">
              {[
                [ShieldCheck, "Single user", "No login or multi-tenant account model in the MVP."],
                [LockKeyhole, "Server-side secrets", "Credentials are accepted by Next routes and withheld from client payloads."],
                [Network, "Loopback Runner", "Runner URLs are validated to localhost, 127.0.0.1, or ::1."],
              ].map(([Icon, title, detail]) => (
                <div className="bg-card p-5" key={title as string}>
                  <Icon className="size-5 text-primary" />
                  <p className="mt-5 font-semibold">{title as string}</p>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">{detail as string}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="failures" className="scroll-mt-24">
            <SectionHeading
              number="09"
              eyebrow="Failure modes"
              title="What happens when part of the ecosystem is unavailable."
            >
              <p>
                The control plane favors explicit status and recoverable local
                records over pretending that a failed dependency succeeded.
              </p>
            </SectionHeading>
            <div className="mt-10 overflow-x-auto border-y">
              <div className="min-w-[760px]">
                <div className="grid grid-cols-[12rem_1fr_1fr] gap-6 border-b bg-muted/50 px-4 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <span>Failure</span>
                  <span>What the user sees</span>
                  <span>Recovery</span>
                </div>
                {[
                  ["Missing MCP config", "Setup shows Missing config; Work or Docs cannot be tested.", "Add the URL and API key in Settings, then run the check again."],
                  ["MCP unavailable", "The view shows a connection error and keeps an actionable empty state.", "Test the connection, refresh the source, or open the remote product."],
                  ["Runner offline", "The run fails with a persisted error; existing threads and messages remain.", "Start Runner on loopback, verify Codex, and send a new message."],
                  ["Codex unavailable", "Runner can be healthy while runtime verification fails separately.", "Repair the Codex installation or Runner adapter, then rerun setup checks."],
                  ["Approval pending", "The thread displays the requested action with Approve and Deny controls.", "Make an explicit decision; duplicate resolution attempts are rejected safely."],
                  ["Runtime thread missing", "The product keeps the conversation while recreating runtime continuity.", "A new Codex thread is created and recent product messages rehydrate context."],
                  ["Browser reload", "Completed messages remain; an in-flight stream may reconnect through persisted Run state.", "Open the thread or Runs view to inspect current state and continue."],
                  ["Next app stopped", "The UI, scheduler, and local orchestration are unavailable.", "Restart npm run dev or npm start. Remote Work and Docs remain authoritative."],
                ].map(([failure, visible, recovery]) => (
                  <div key={failure} className="grid grid-cols-[12rem_1fr_1fr] gap-6 border-b px-4 py-4 text-sm last:border-b-0">
                    <strong>{failure}</strong>
                    <span className="leading-6 text-muted-foreground">{visible}</span>
                    <span className="leading-6 text-muted-foreground">{recovery}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section id="boundaries" className="scroll-mt-24">
            <SectionHeading
              number="10"
              eyebrow="MVP boundaries"
              title="Deliberately local, simple, and operational."
            >
              <p>
                The MVP proves one relationship well: Agent ↔ Work ↔ Docs. The
                boundaries below prevent the control plane from becoming a
                premature platform.
              </p>
            </SectionHeading>
            <div className="mt-10 grid gap-10 lg:grid-cols-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-[.16em] text-emerald-800">
                  Included now
                </p>
                <div className="mt-3 divide-y border-y">
                  {[
                    "Local single-user Next.js control plane",
                    "Remote Slab Work and Slab Docs adapters",
                    "Codex agents through local Slab Runner",
                    "Persistent threads, messages, runs, events, and approvals",
                    "Manual and cron automations",
                    "Server-side secrets and loopback execution",
                  ].map((item) => (
                    <div key={item} className="flex gap-3 py-3 text-sm">
                      <Check className="mt-0.5 size-4 shrink-0 text-emerald-700" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[.16em] text-muted-foreground">
                  Intentionally deferred
                </p>
                <div className="mt-3 divide-y border-y">
                  {[
                    "SaaS, accounts, organizations, multi-tenancy, or RBAC",
                    "Agent-to-agent conversations and delegation loops",
                    "Honcho, vector memory, or semantic search",
                    "Gmail, Calendar, CRM, analytics, and arbitrary MCP marketplace",
                    "Durable distributed jobs, webhooks, and remote triggers",
                    "Billing, token budgets, and visual workflow builders",
                  ].map((item) => (
                    <div key={item} className="flex gap-3 py-3 text-sm text-muted-foreground">
                      <CircleDot className="mt-0.5 size-4 shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-12 border-y bg-foreground p-6 text-background sm:p-10">
              <Sparkles className="size-5 text-primary" />
              <p className="mt-8 max-w-4xl font-heading text-[clamp(2.2rem,5vw,5rem)] font-semibold leading-[.95] tracking-[-.04em]">
                Slab is what needs doing. Docs is what we know. Next decides who
                acts and when. Runner makes the agent real.
              </p>
              <Separator className="my-8 bg-background/20" />
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" asChild>
                  <Link href="/">
                    <Play /> Create operating loop
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  className="border-background/30 bg-transparent text-background hover:bg-background hover:text-foreground"
                  asChild
                >
                  <Link href="/agents">
                    <Bot /> Meet the agents
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
          </section>
        </article>
      </div>
    </>
  );
}
