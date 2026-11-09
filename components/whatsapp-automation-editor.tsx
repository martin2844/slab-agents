"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageCircle, Settings2, ShieldCheck, Clock3 } from "lucide-react";
import { toast } from "sonner";
import { AutomationFormSection } from "@/components/automation-form-section";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client-api";
import { whatsappPauseTitle } from "@/lib/whatsapp-chat-status";
import {
  WHATSAPP_REPLY_LANGUAGES,
  DEFAULT_WHATSAPP_REPLY_SAFEGUARDS,
  whatsappAutomationSchema,
  type WhatsAppConversationState,
} from "@/lib/whatsapp-automation";
import type { AutomationTemplate } from "@/lib/automation-templates";
import type { Automation, AutomationsData } from "@/lib/types";

type Contact = { id: string; name: string };
const selectStyle = "h-9 rounded-md border bg-background px-3 text-sm";
export function WhatsAppAutomationEditor({
  automation,
  template,
  data,
  embedded = false,
}: {
  automation: Automation | null;
  template: AutomationTemplate | null;
  data: AutomationsData;
  embedded?: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(automation);
  const [name, setName] = useState(automation?.name ?? "WhatsApp replies");
  const [agentId, setAgentId] = useState(automation?.agentId ?? "");
  const [prompt, setPrompt] = useState(
    automation?.prompt ?? template?.prompt ?? "",
  );
  const [language, setLanguage] = useState(
    automation?.whatsapp?.replyLanguage ?? "es",
  );
  const [replyApproval, setReplyApproval] = useState(
    automation
      ? (automation.whatsapp?.replyApproval ?? "inherit")
      : "approval_required",
  );
  const [automaticReplyCriteria, setAutomaticReplyCriteria] = useState(
    automation?.whatsapp?.automaticReplyCriteria ?? "",
  );
  const [reviewCriteria, setReviewCriteria] = useState(
    automation?.whatsapp?.reviewCriteria ?? "",
  );
  const [reviewFallbackHours, setReviewFallbackHours] = useState(
    automation?.whatsapp?.reviewFallbackHours ?? 24,
  );
  const [replySafeguards, setReplySafeguards] = useState(
    automation?.whatsapp?.replySafeguards ?? DEFAULT_WHATSAPP_REPLY_SAFEGUARDS,
  );
  const [quiet, setQuiet] = useState(automation?.whatsapp?.quietSeconds ?? 8);
  const [maximum, setMaximum] = useState(
    automation?.whatsapp?.maxWaitSeconds ?? 30,
  );
  const [audience, setAudience] = useState(
    automation?.whatsapp?.audience ?? "selected",
  );
  const [chatIds, setChatIds] = useState(automation?.whatsapp?.chatIds ?? []);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [offset, setOffset] = useState<number | null>(0);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<
    WhatsAppConversationState[]
  >([]);
  const savedId = saved?.id;
  const account =
    automation?.whatsapp?.account ?? data.whatsapp?.accountEmail ?? "";
  const grants = data.whatsapp?.permissions[agentId] ?? [];
  const ready =
    data.whatsapp?.enabled &&
    data.whatsapp.accountEmail === account &&
    grants.includes("whatsapp_get_messages") &&
    grants.includes("whatsapp_send_text") &&
    data.agents.find((agent) => agent.id === agentId)?.runtime !== "gemini";
  const writeMode =
    data.whatsapp?.whatsappWriteModes?.[agentId] ?? "approval_required";
  const allContacts = [
    ...contacts,
    ...chatIds
      .filter((id) => !contacts.some((contact) => contact.id === id))
      .map((id) => ({ id, name: id.split("@")[0]! })),
  ];

  useEffect(() => {
    if (!savedId) return;
    let stopped = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const next = await api<WhatsAppConversationState[]>(
          `/api/automations/${savedId}/whatsapp/conversations`,
          { signal: controller.signal },
        );
        if (!stopped) setConversations(next);
      } catch (reason) {
        if (!stopped)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not refresh conversations.",
          );
      } finally {
        if (!stopped) timer = setTimeout(refresh, 4000);
      }
    }
    void refresh();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [savedId]);

  async function loadContacts() {
    setBusy(true);
    setError(null);
    try {
      const next = await api<{
        account: string;
        chats: Contact[];
        nextOffset: number | null;
      }>(`/api/integrations/whatsapp/chats?offset=${offset ?? 0}`);
      if (next.account !== account)
        throw new Error(
          "The linked account changed. Create an automation for the current account.",
        );
      setContacts((current) => [
        ...current,
        ...next.chats.filter(
          (contact) => !current.some((item) => item.id === contact.id),
        ),
      ]);
      setOffset(next.nextOffset);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not load contacts.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save(lifecycleStatus: Automation["lifecycleStatus"]) {
    setError(null);
    const parsed = whatsappAutomationSchema.safeParse({
      account,
      audience,
      chatIds: audience === "all" ? [] : chatIds,
      replyLanguage: language,
      replyApproval,
      automaticReplyCriteria,
      reviewCriteria,
      reviewFallbackHours:
        replyApproval === "review_exceptions" ? reviewFallbackHours : 0,
      replySafeguards,
      quietSeconds: quiet,
      maxWaitSeconds: maximum,
    });
    if (
      !parsed.success ||
      !agentId ||
      name.trim().length < 2 ||
      prompt.trim().length < 2
    ) {
      setError(
        !agentId
          ? "Choose the agent that will reply."
          : name.trim().length < 2
            ? "Give this automation a name."
            : prompt.trim().length < 2
              ? "Add instructions for when and how to reply."
              : !account
                ? "Connect your WhatsApp account in Integrations first."
                : !parsed.success
                  ? (parsed.error.issues[0]?.message ??
                    "Check your reply settings.")
                  : "Check your reply settings.",
      );
      return;
    }
    setBusy(true);
    try {
      const next = await api<Automation>(
        saved ? `/api/automations/${saved.id}` : "/api/automations",
        {
          method: saved ? "PATCH" : "POST",
          body: JSON.stringify({
            name,
            agentId,
            prompt,
            whatsapp: parsed.data,
            mode: "task",
            lifecycleStatus,
            enabled: lifecycleStatus === "enabled",
            cronExpression: null,
            emailAccountId: null,
            ...(saved
              ? { expectedWorkflowVersion: saved.workflowVersion }
              : { triggerType: "whatsapp" }),
          }),
        },
      );
      setSaved(next);
      toast.success(
        lifecycleStatus === "enabled"
          ? "WhatsApp replies activated"
          : "WhatsApp automation saved",
      );
      if (!saved) router.replace(`/automations/${next.id}`);
      router.refresh();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not save automation.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function setPaused(chatId: string, paused: boolean) {
    if (!saved) return;
    setBusy(true);
    setError(null);
    try {
      setConversations(
        await api<WhatsAppConversationState[]>(
          `/api/automations/${saved.id}/whatsapp/conversations`,
          {
            method: "PATCH",
            body: JSON.stringify({ chatId, paused }),
          },
        ),
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not update chat.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-6">
      {!embedded && (
        <>
          <PageHeader
            title={saved ? "Edit WhatsApp automation" : "WhatsApp replies"}
            description="Choose who the agent can reply to and what it should say."
          />
          <div>
            <Button variant="ghost" asChild>
              <Link href="/automations">← Automations</Link>
            </Button>
          </div>
        </>
      )}
      <AutomationFormSection
        icon={Settings2}
        title="Basics"
        description="Choose an agent, a language and instructions for replying."
      >
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm">
            Name
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
            />
          </label>
          <label className="grid gap-2 text-sm">
            Agent
            <select
              className={selectStyle}
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
            >
              <option value="">Choose an agent</option>
              {data.agents
                .filter((agent) => agent.enabled && agent.runtime !== "gemini")
                .map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
            </select>
            <span className="text-xs text-muted-foreground">
              Only agents that support WhatsApp replies are shown.
            </span>
          </label>
          <label className="grid gap-2 text-sm">
            Reply language
            <select
              className={selectStyle}
              value={language}
              onChange={(event) =>
                setLanguage(event.target.value as typeof language)
              }
            >
              {Object.entries(WHATSAPP_REPLY_LANGUAGES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            Before sending a reply
            <select
              className={selectStyle}
              value={replyApproval}
              onChange={(event) =>
                setReplyApproval(event.target.value as typeof replyApproval)
              }
            >
              <option value="approval_required">Always ask me</option>
              <option value="review_exceptions">
                Send automatically, ask me only for exceptions
              </option>
              <option value="conditional">
                Ask me except in certain cases
              </option>
              <option value="autonomous">Send without asking</option>
              <option value="inherit">
                Use agent setting (
                {writeMode === "autonomous" ? "without asking" : "ask me first"}
                )
              </option>
            </select>
          </label>
          {replyApproval === "review_exceptions" && (
            <>
              <label className="grid gap-2 text-sm sm:col-span-2">
                Which conversations need your review?
                <Textarea
                  value={reviewCriteria}
                  rows={4}
                  maxLength={5000}
                  placeholder="High-value business prospects: companies asking about integrations, high volume or custom pricing, or anyone asking to talk to me about a deal."
                  onChange={(event) => setReviewCriteria(event.target.value)}
                />
                <span className="text-xs font-normal text-muted-foreground">
                  Every other message gets an automatic reply. For these, the
                  agent drafts a reply and waits for your approval.
                </span>
              </label>
              <label className="grid gap-2 text-sm">
                If I don’t review it
                <select
                  className={selectStyle}
                  value={reviewFallbackHours}
                  onChange={(event) =>
                    setReviewFallbackHours(Number(event.target.value))
                  }
                >
                  <option value={0}>Keep waiting for me</option>
                  <option value={1}>Send the draft after 1 hour</option>
                  <option value={4}>Send the draft after 4 hours</option>
                  <option value={12}>Send the draft after 12 hours</option>
                  <option value={24}>Send the draft after 1 day</option>
                  <option value={48}>Send the draft after 2 days</option>
                </select>
                <span className="text-xs font-normal text-muted-foreground">
                  Nothing is sent if the customer writes again or you reply
                  yourself first.
                </span>
              </label>
            </>
          )}
          {replyApproval === "conditional" && (
            <label className="grid gap-2 text-sm sm:col-span-2">
              When can replies be sent without asking?
              <Textarea
                value={automaticReplyCriteria}
                rows={4}
                maxLength={5000}
                placeholder="Questions about opening hours or our address can be answered automatically. Ask me before discussing prices, making commitments, or handling complaints."
                onChange={(event) =>
                  setAutomaticReplyCriteria(event.target.value)
                }
              />
              <span className="text-xs font-normal text-muted-foreground">
                The agent checks your criteria for each reply. Anything else, or
                anything uncertain, needs your approval.
              </span>
            </label>
          )}
          <p className="text-xs text-muted-foreground sm:col-span-2">
            This choice applies only to this automation. Other messages use the
            agent’s settings in Integrations. The agent still needs permission
            to read and send messages.
          </p>
          <label className="grid gap-2 text-sm sm:col-span-2">
            When and how to reply
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={7}
              maxLength={20000}
            />
            <span className="text-xs text-muted-foreground">
              Say which messages to answer or ignore, what information to share,
              and when to leave the conversation to you. The agent reviews new
              messages and can choose not to send a reply.
            </span>
          </label>
        </div>
      </AutomationFormSection>
      <AutomationFormSection
        icon={MessageCircle}
        title="Who can receive replies?"
        description="Choose specific contacts or anyone who messages you privately. Group chats and broadcasts are not included."
      >
        <div className="grid max-w-3xl gap-3">
          <p className="text-sm">
            Your WhatsApp:{" "}
            {account ? `+${account.split("@")[0]}` : "Not connected"}
          </p>
          {!ready && (
            <p className="text-sm text-muted-foreground">
              Before activating, connect WhatsApp and allow this agent to read
              and send messages in{" "}
              <Link className="underline" href="/integrations">
                Integrations
              </Link>
              .
            </p>
          )}
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">Who can receive replies?</legend>
            {(
              [
                [
                  "selected",
                  "Choose contacts",
                  "Only the people you select below.",
                ],
                [
                  "all",
                  "Anyone who messages me",
                  "Includes people who are not in your contacts.",
                ],
              ] as const
            ).map(([value, label, hint]) => (
              <label
                key={value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${audience === value ? "border-accent bg-accent-muted/40" : ""}`}
              >
                <input
                  type="radio"
                  name="whatsapp-audience"
                  value={value}
                  checked={audience === value}
                  onChange={() => setAudience(value)}
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium">{label}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {hint}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          {audience === "selected" && (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <Button
                  variant="outline"
                  disabled={busy || !account || offset === null}
                  onClick={() => void loadContacts()}
                >
                  {contacts.length ? "Load more contacts" : "Load contacts"}
                </Button>
                <label className="grid gap-1 text-xs">
                  Add someone by phone number
                  <Input
                    value={phone}
                    placeholder="+34 600 000 000"
                    onChange={(event) => setPhone(event.target.value)}
                  />
                </label>
                <Button
                  variant="outline"
                  disabled={
                    busy ||
                    !/^\+?[\d ()-]{5,30}$/.test(phone) ||
                    !/^\d{5,15}$/.test(phone.replace(/\D/g, "")) ||
                    `${phone.replace(/\D/g, "")}@c.us` === account ||
                    chatIds.length >= 100
                  }
                  onClick={() => {
                    const id = `${phone.replace(/\D/g, "")}@c.us`;
                    if (!chatIds.includes(id)) setChatIds([...chatIds, id]);
                    setPhone("");
                  }}
                >
                  Add contact
                </Button>
              </div>
              <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
                {allContacts.map((contact) => (
                  <label
                    key={contact.id}
                    className="flex items-center gap-2 rounded border p-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={chatIds.includes(contact.id)}
                      disabled={
                        !chatIds.includes(contact.id) && chatIds.length >= 100
                      }
                      onChange={(event) =>
                        setChatIds(
                          event.target.checked
                            ? [...chatIds, contact.id]
                            : chatIds.filter((id) => id !== contact.id),
                        )
                      }
                    />
                    <span className="min-w-0 truncate">{contact.name}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {chatIds.length
                  ? `${chatIds.length} contacts selected.`
                  : "Load your chats to choose contacts, or add a number with its country code."}
              </p>
            </>
          )}
          <p className="text-xs text-muted-foreground">
            Replies start with new messages after activation. Older messages
            will not be answered.
          </p>
        </div>
      </AutomationFormSection>
      <AutomationFormSection
        icon={Clock3}
        title="Reply timing"
        description="Give people time to finish typing. Messages sent together are reviewed together."
      >
        <div className="grid max-w-lg gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm">
            Wait after the last message (seconds)
            <Input
              type="number"
              min={1}
              max={60}
              value={quiet}
              onChange={(event) => setQuiet(Number(event.target.value))}
            />
          </label>
          <label className="grid gap-2 text-sm">
            Wait no longer than (seconds)
            <Input
              type="number"
              min={5}
              max={120}
              value={maximum}
              onChange={(event) => setMaximum(Number(event.target.value))}
            />
          </label>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          If another message arrives while the agent is preparing a reply, it
          updates its answer before sending. Replying yourself pauses the agent
          in that chat until you resume it below.
        </p>
      </AutomationFormSection>
      <AutomationFormSection
        icon={ShieldCheck}
        title="Reply safeguards"
        description="Start with our suggested rules, then edit them or add your own."
      >
        <div className="grid max-w-3xl gap-3">
          <label className="grid gap-2 text-sm">
            Rules for replies
            <Textarea
              value={replySafeguards}
              rows={9}
              maxLength={12000}
              className="min-h-52 resize-y"
              onChange={(event) => setReplySafeguards(event.target.value)}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Add limits on what to share, how to respond and when to leave a
            conversation to you. Your language choice, approval settings and
            protections for private data still apply.
          </p>
          <div>
            <Button
              variant="outline"
              type="button"
              disabled={replySafeguards === DEFAULT_WHATSAPP_REPLY_SAFEGUARDS}
              onClick={() =>
                setReplySafeguards(DEFAULT_WHATSAPP_REPLY_SAFEGUARDS)
              }
            >
              Restore suggested rules
            </Button>
          </div>
        </div>
      </AutomationFormSection>
      {!!conversations.length && (
        <AutomationFormSection
          icon={MessageCircle}
          title="Auto replies by chat"
          description="Replying manually pauses this chat. Enable auto replies again when you want the agent to take over. It will only answer new messages."
        >
          <div id="chat-replies" className="grid scroll-mt-6 gap-2">
            {conversations.map((chat) => (
              <div
                key={chat.chatId}
                className={`flex flex-wrap items-center justify-between gap-3 rounded border p-3 text-sm ${chat.paused ? "border-amber-500/40 bg-amber-500/5" : ""}`}
              >
                <div>
                  <p>
                    {allContacts.find((contact) => contact.id === chat.chatId)
                      ?.name ?? chat.chatId.split("@")[0]}{" "}
                    ·{" "}
                    {chat.paused
                      ? whatsappPauseTitle(chat.pauseReason)
                      : saved?.enabled
                        ? "Auto replies on"
                        : "Auto replies off"}
                  </p>
                  {chat.pauseReason && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {chat.pauseReason}
                    </p>
                  )}
                  {chat.paused && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Only new messages will receive an automatic reply after
                      you enable it again.
                    </p>
                  )}
                  {chat.paused && !saved?.enabled && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Activate this automation before enabling auto replies.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {chat.pendingMessages} messages waiting
                    {chat.lastReplyOutcome && (
                      <>
                        {" "}
                        ·{" "}
                        {
                          {
                            sent: "Reply sent",
                            failed: "Reply failed — check activity",
                            uncertain: "Delivery unconfirmed — check WhatsApp",
                            pending: "Run in progress",
                            not_sent: "No reply sent",
                          }[chat.lastReplyOutcome]
                        }
                      </>
                    )}
                    {(chat.activeRunId || chat.lastRunId) && (
                      <>
                        {" "}
                        ·{" "}
                        <Link
                          className="underline"
                          href={`/runs/${chat.activeRunId || chat.lastRunId}`}
                        >
                          View activity
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                <Button
                  variant={chat.paused ? "default" : "outline"}
                  disabled={busy || (chat.paused && !saved?.enabled)}
                  onClick={() => void setPaused(chat.chatId, !chat.paused)}
                >
                  {chat.paused
                    ? "Enable auto replies again"
                    : "Pause auto replies"}
                </Button>
              </div>
            ))}
          </div>
        </AutomationFormSection>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void save(
              saved?.enabled ? "paused" : (saved?.lifecycleStatus ?? "draft"),
            )
          }
        >
          {saved?.enabled ? "Save and pause" : "Save draft"}
        </Button>
        <Button
          disabled={
            busy || !ready || (audience === "selected" && !chatIds.length)
          }
          onClick={() => void save("enabled")}
        >
          {busy
            ? "Saving…"
            : saved?.enabled
              ? "Save and keep replies on"
              : "Activate replies"}
        </Button>
      </div>
    </div>
  );
}
