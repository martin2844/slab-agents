"use client";

import {
  Bot,
  CheckCircle2,
  ChevronDown,
  Mail,
  Plus,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  Agent,
  AutomationsData,
  EmailAccount,
} from "@/lib/types";
import {
  nextAutomationWorkflowStepId,
  type AutomationWorkflowStep,
  type EmailAutomationMatch,
} from "@/lib/automation-workflow";

export type EmailWorkflowDraft = {
  name: string;
  emailAccountId: string;
  emailMatch: EmailAutomationMatch;
  steps: AutomationWorkflowStep[];
};

export function isEmailWorkflowDraftValid(draft: EmailWorkflowDraft) {
  return Boolean(
    draft.name.trim() &&
      draft.emailAccountId &&
      draft.steps.length &&
      draft.steps.every(
        (step) => step.agentId && step.prompt.trim().length >= 2,
      ),
  );
}

const actionCopy: Record<
  AutomationWorkflowStep["action"],
  { label: string; description: string }
> = {
  analyze: {
    label: "Analyze",
    description: "Read the message and produce an internal outcome.",
  },
  draft_reply: {
    label: "Draft reply",
    description: "Prepare a send-ready response without sending it.",
  },
  review_and_reply: {
    label: "Review and reply",
    description: "Review the handoff, then reply under the Email send policy.",
  },
};

export function defaultEmailWorkflowDraft(input: {
  agents: Agent[];
  accounts: EmailAccount[];
  emailAccess: AutomationsData["emailAccess"];
}): EmailWorkflowDraft {
  const accountId = input.accounts[0]?.id ?? "";
  const agent = input.agents.find((candidate) =>
    input.emailAccess.some(
      (access) =>
        access.agentId === candidate.id &&
        access.readEnabled &&
        access.accountIds.includes(accountId),
    ),
  );
  return {
    name: "",
    emailAccountId: accountId,
    emailMatch: {
      recipientAddress: null,
      senderAddress: null,
      senderDomain: null,
      subjectIncludes: null,
    },
    steps: agent
      ? [
          {
            id: nextAutomationWorkflowStepId([]),
            type: "agent_task",
            agentId: agent.id,
            action: "analyze",
            prompt: "Read the inbound message and handle it according to your role.",
          },
        ]
      : [],
  };
}

export function EmailAutomationWorkflowEditor({
  draft,
  onChange,
  agents,
  accounts,
  emailAccess,
}: {
  draft: EmailWorkflowDraft;
  onChange: (draft: EmailWorkflowDraft) => void;
  agents: Agent[];
  accounts: EmailAccount[];
  emailAccess: AutomationsData["emailAccess"];
}) {
  const accessFor = (agentId: string) =>
    emailAccess.find(
      (access) =>
        access.agentId === agentId &&
        access.readEnabled &&
        access.accountIds.includes(draft.emailAccountId),
    );
  const selectedAccount = accounts.find(
    ({ id }) => id === draft.emailAccountId,
  );
  const eligibleAgents = (action: AutomationWorkflowStep["action"]) =>
    agents.filter((agent) => {
      const access = accessFor(agent.id);
      if (!access) return false;
      return action !== "review_and_reply"
        ? true
        : selectedAccount?.capabilities.reply === true &&
            access.sendEnabled &&
            access.sendPolicy !== "disabled";
    });
  const updateStep = (
    id: string,
    update: Partial<AutomationWorkflowStep>,
  ) =>
    onChange({
      ...draft,
      steps: draft.steps.map((step) =>
        step.id === id ? { ...step, ...update } : step,
      ),
    });
  const selectAccount = (emailAccountId: string) => {
    const nextAccount = accounts.find(({ id }) => id === emailAccountId);
    const accountAccess = emailAccess.filter(
      (access) =>
        access.readEnabled && access.accountIds.includes(emailAccountId),
    );
    const nextSteps = draft.steps.flatMap((step) => {
      const current = accountAccess.find(
        ({ agentId }) => agentId === step.agentId,
      );
      const canKeep =
        current &&
        (step.action !== "review_and_reply" ||
          (nextAccount?.capabilities.reply === true &&
            current.sendEnabled &&
            current.sendPolicy !== "disabled"));
      if (canKeep) return [step];
      const replacement = accountAccess.find((access) =>
        step.action !== "review_and_reply"
          ? true
          : nextAccount?.capabilities.reply === true &&
            access.sendEnabled &&
            access.sendPolicy !== "disabled",
      );
      return replacement ? [{ ...step, agentId: replacement.agentId }] : [];
    });
    onChange({ ...draft, emailAccountId, steps: nextSteps });
  };
  const addStep = () => {
    const action: AutomationWorkflowStep["action"] = "draft_reply";
    const agent = eligibleAgents(action)[0];
    if (!agent || draft.steps.length >= 8) return;
    onChange({
      ...draft,
      steps: [
        ...draft.steps,
        {
          id: nextAutomationWorkflowStepId(draft.steps),
          type: "agent_task",
          agentId: agent.id,
          action,
          prompt: "Prepare the next response using the message and prior workflow output.",
        },
      ],
    });
  };
  const hasReply = draft.steps.some(
    ({ action }) => action === "review_and_reply",
  );

  return (
    <div className="grid gap-6">
      <label className="grid gap-2 text-sm font-semibold">
        Name
        <Input
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
          placeholder="Support inbox triage"
          required
          autoFocus
        />
      </label>

      <section className="grid gap-3">
        <div>
          <h3 className="text-sm font-semibold">When an email is received</h3>
          <p className="text-xs text-muted-foreground">
            Only newly discovered inbound messages are evaluated.
          </p>
        </div>
        <div className="rounded-lg border bg-muted/25 p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Mail className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Inbound Email</p>
              <p className="text-xs text-muted-foreground">
                Starts once for each matching connector event.
              </p>
            </div>
          </div>
          <label className="mt-4 grid gap-2 text-xs font-semibold">
            Receiving account
            <Select value={draft.emailAccountId} onValueChange={selectAccount}>
              <SelectTrigger className="w-full min-w-0">
                <SelectValue className="min-w-0 truncate">
                  {selectedAccount
                    ? `${selectedAccount.displayName} · ${selectedAccount.emailAddress}`
                    : "Choose an account"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.displayName} · {account.emailAddress}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2">
            <FilterInput
              label="Recipient is"
              placeholder="support@example.com"
              value={draft.emailMatch.recipientAddress}
              onChange={(recipientAddress) =>
                onChange({
                  ...draft,
                  emailMatch: { ...draft.emailMatch, recipientAddress },
                })
              }
            />
            <FilterInput
              label="Sender is"
              placeholder="customer@example.com"
              value={draft.emailMatch.senderAddress}
              onChange={(senderAddress) =>
                onChange({
                  ...draft,
                  emailMatch: { ...draft.emailMatch, senderAddress },
                })
              }
            />
            <FilterInput
              label="Sender domain is"
              placeholder="example.com"
              value={draft.emailMatch.senderDomain}
              onChange={(senderDomain) =>
                onChange({
                  ...draft,
                  emailMatch: { ...draft.emailMatch, senderDomain },
                })
              }
            />
            <FilterInput
              label="Subject contains"
              placeholder="pricing"
              value={draft.emailMatch.subjectIncludes}
              onChange={(subjectIncludes) =>
                onChange({
                  ...draft,
                  emailMatch: { ...draft.emailMatch, subjectIncludes },
                })
              }
            />
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Empty filters match every inbound message for this account. All
            configured filters must match.
          </p>
        </div>
      </section>

      <section className="grid gap-3">
        <div>
          <h3 className="text-sm font-semibold">Then run these agent steps</h3>
          <p className="text-xs text-muted-foreground">
            Steps run in order. Each one gets a fresh runtime thread and a
            bounded handoff from the previous step.
          </p>
        </div>
        <div className="grid gap-2">
          {draft.steps.map((step, index) => {
            const candidates = eligibleAgents(step.action);
            const access = accessFor(step.agentId);
            const selectedAgent = agents.find(({ id }) => id === step.agentId);
            return (
              <div key={step.id} className="relative grid gap-3">
                {index > 0 && (
                  <div className="flex h-5 items-center pl-4 text-muted-foreground">
                    <div className="h-5 border-l" />
                    <ChevronDown className="-ml-2.5 mt-4 size-4 bg-background" />
                  </div>
                )}
                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-muted text-success">
                      {step.action === "review_and_reply" ? (
                        <CheckCircle2 className="size-4" />
                      ) : (
                        <Bot className="size-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold">
                          Step {index + 1}
                        </p>
                        {draft.steps.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              onChange({
                                ...draft,
                                steps: draft.steps.filter(
                                  ({ id }) => id !== step.id,
                                ),
                              })
                            }
                            aria-label={`Remove step ${index + 1}`}
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <label className="grid gap-2 text-xs font-semibold">
                          Action
                          <Select
                            value={step.action}
                            onValueChange={(value) => {
                              const action =
                                value as AutomationWorkflowStep["action"];
                              const nextAgent = eligibleAgents(action).find(
                                ({ id }) => id === step.agentId,
                              ) ?? eligibleAgents(action)[0];
                              updateStep(step.id, {
                                action,
                                type:
                                  action === "review_and_reply"
                                    ? "agent_review"
                                    : "agent_task",
                                ...(nextAgent
                                  ? { agentId: nextAgent.id }
                                  : {}),
                              });
                            }}
                          >
                            <SelectTrigger className="w-full min-w-0">
                              <SelectValue className="min-w-0 truncate">
                                {actionCopy[step.action].label}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="analyze">Analyze</SelectItem>
                              <SelectItem value="draft_reply">
                                Draft reply
                              </SelectItem>
                              <SelectItem
                                value="review_and_reply"
                                disabled={
                                  index !== draft.steps.length - 1 ||
                                  eligibleAgents("review_and_reply").length === 0
                                }
                              >
                                Review and reply
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </label>
                        <label className="grid gap-2 text-xs font-semibold">
                          Agent
                          <Select
                            value={step.agentId}
                            onValueChange={(agentId) =>
                              updateStep(step.id, { agentId })
                            }
                          >
                            <SelectTrigger className="w-full min-w-0">
                              <SelectValue className="min-w-0 truncate">
                                {selectedAgent
                                  ? `${selectedAgent.name} · ${selectedAgent.role}`
                                  : "Choose an agent"}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {candidates.map((agent) => (
                                <SelectItem key={agent.id} value={agent.id}>
                                  {agent.name} · {agent.role}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </label>
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        {actionCopy[step.action].description}
                        {step.action === "review_and_reply" && access
                          ? ` Send policy: ${access.sendPolicy.replaceAll("_", " ")}.`
                          : ""}
                      </p>
                      <label className="mt-3 grid gap-2 text-xs font-semibold">
                        Instructions
                        <Textarea
                          value={step.prompt}
                          onChange={(event) =>
                            updateStep(step.id, { prompt: event.target.value })
                          }
                          className="min-h-24 resize-y"
                          placeholder="Describe the outcome this step should produce…"
                          required
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {!draft.steps.length && (
          <p className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            No enabled agent can read this account. Assign Email access before
            saving the workflow.
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          className="justify-center"
          onClick={addStep}
          disabled={
            hasReply ||
            draft.steps.length >= 8 ||
            eligibleAgents("draft_reply").length === 0
          }
        >
          <Plus /> Add agent step
        </Button>
        {hasReply && (
          <div className="grid gap-1 rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            <p>
              Review and reply is terminal. Remove it before adding another
              step.
            </p>
            <p>
              Agent review and operator approval are separate: an
              approval-required send pauses in Runs before the Email provider
              receives the reply.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function FilterInput({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <label className="grid gap-2 text-xs font-semibold">
      {label}
      <Input
        value={value ?? ""}
        onChange={(event) =>
          onChange(event.target.value === "" ? null : event.target.value)
        }
        placeholder={placeholder}
      />
    </label>
  );
}
