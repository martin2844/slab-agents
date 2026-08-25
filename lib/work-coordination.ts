import "server-only";

import { repository } from "@/lib/repository";
import { createRunExecution, executeRunInBackground } from "@/lib/run-service";
import { WorkClient } from "@/lib/mcp/work-client";
import type { Agent, Comment, Issue } from "@/lib/types";
import { mentionHandles, sameAgentIdentity } from "@/lib/work-status";
import { mapWithConcurrency } from "@/lib/async";
import { getSetting } from "@/lib/settings";
import { workCoordinationStore } from "@/lib/repositories/work-coordination-store";

type TriggerType =
  "assignment" | "resumed" | "review_requested" | "blocked" | "mention";

const state = globalThis as unknown as {
  slabWorkCoordinator?: NodeJS.Timeout;
  slabWorkCoordinatorInFlight?: Promise<void>;
  slabWorkCoordinatorTick?: () => Promise<void>;
};

function identifier(value: string | null | undefined) {
  return value?.trim().replace(/^@/, "").toLocaleLowerCase() ?? "";
}

export function resolveAgent(
  agents: Agent[],
  value: string | null | undefined,
) {
  const target = identifier(value);
  if (!target) return null;
  return (
    agents.find(
      (agent) =>
        identifier(agent.id) === target ||
        identifier(agent.slug) === target ||
        identifier(agent.name) === target,
    ) ?? null
  );
}

export function mentionedAgents(agents: Agent[], comment: Comment) {
  const handles = mentionHandles(comment.body);
  return agents.filter(
    (agent) =>
      handles.some(
        (handle) =>
          handle === identifier(agent.slug) ||
          handle === identifier(agent.name),
      ) &&
      ![agent.id, agent.slug, agent.name].some((identity) =>
        sameAgentIdentity(comment.author, identity),
      ),
  );
}

function eventToken(issue: Issue) {
  return String(
    issue.version ??
      issue.updated_at ??
      `${issue.status}:${(issue.labels ?? []).join(",")}`,
  );
}

export function coordinationInstructions(input: {
  type: TriggerType;
  issue: Issue;
  agent: Agent;
  comment?: Comment;
}) {
  const { type, issue, agent, comment } = input;
  const statusConvention = [
    "Work only exposes new, in_progress, and done as native states.",
    'For semantic review, use remote status in_progress and label "status:review".',
    'For semantic blocked, use remote status in_progress and label "status:blocked".',
    "Remove those semantic labels when they no longer apply.",
  ].join(" ");

  if (type === "review_requested") {
    return [
      `El work item ${issue.key} (${issue.title}) solicita revisión del COO.`,
      "Leé el issue completo, su definición de terminado, relaciones y comentarios.",
      "Evaluá el trabajo entregado sin rehacer el trabajo del agente asignado.",
      "Si cumple, dejá un comentario breve de aprobación y marcá el issue done.",
      'Si no cumple, dejá feedback concreto, remové "status:review", mantenelo in_progress y conservá o devolvé el assignee original.',
      "Toda conclusión operativa debe quedar registrada como comentario en Work; no alcanza con responder solamente en este thread.",
      statusConvention,
    ].join("\n\n");
  }

  if (type === "blocked") {
    return [
      `El work item ${issue.key} (${issue.title}) fue marcado blocked por ${issue.assignee ?? "su agente asignado"}.`,
      "Leé el issue completo, sus relaciones, comentarios y documentación relevante.",
      "Determiná si el bloqueo puede resolverse con información o criterio ya disponible.",
      'Si podés resolverlo, comentá la decisión, remové "status:blocked" y devolvé el item a in_progress para el agente asignado.',
      `Si requiere una decisión de ${getSetting("operator_display_name")} o información externa, dejá una solicitud breve y precisa en el issue y mantenelo blocked.`,
      "No inventes una decisión ni ejecutes el trabajo comercial que corresponde al agente asignado.",
      statusConvention,
    ].join("\n\n");
  }

  if (type === "mention" && comment) {
    return [
      `${comment.author} mencionó a ${agent.name} en ${issue.key} (${issue.title}).`,
      `Comentario: ${comment.body}`,
      "Leé el issue completo, los comentarios y la documentación relevante antes de responder.",
      `Respondé en ${issue.key} mediante un comentario y actualizá el estado sólo si corresponde. No respondas únicamente en este thread.`,
      statusConvention,
    ].join("\n\n");
  }

  if (type === "resumed") {
    return [
      `El work item ${issue.key} (${issue.title}) volvió a in_progress después de una revisión o bloqueo.`,
      "Leé los comentarios y cambios más recientes para entender la decisión o el feedback recibido.",
      "Retomá únicamente el trabajo pendiente, documentá el nuevo resultado en Work y actualizá su estado semántico al terminar.",
      "No repitas análisis ya registrado salvo que el nuevo contexto lo vuelva necesario.",
      statusConvention,
    ].join("\n\n");
  }

  return [
    `Te asignaron el work item ${issue.key}: ${issue.title}.`,
    "Leé el issue completo, sus comentarios y relaciones antes de actuar.",
    "Consultá Docs para validar información relevante y evitá inventar datos.",
    "Ejecutá el resultado solicitado y registrá avances y resultado final como comentarios en Work, usando tu slug como author.",
    "Marcá in_progress al comenzar. Evaluá el cierre contra el entregable solicitado en este item, no contra todas las acciones posteriores posibles.",
    "Usá done cuando ese entregable esté completo y sea verificable, aunque queden recomendaciones o próximos pasos. Usá review sólo cuando el entregable mismo requiera aprobación, aceptación o validación. Usá blocked sólo cuando no puedas producir el entregable actual, y explicá exactamente qué falta.",
    "No alcanza con responder en este thread: el work item es la fuente de verdad.",
    statusConvention,
  ].join("\n\n");
}

export function coordinationInput(input: {
  type: TriggerType;
  issue: Issue;
  agent: Agent;
  comment?: Comment;
}) {
  const { type, issue, agent, comment } = input;
  return [
    `Work coordination event: ${type}`,
    `Associated issue: ${issue.key}`,
    `Title: ${issue.title}`,
    `Status: ${issue.status}`,
    `Priority: ${issue.priority}`,
    `Assignee: ${issue.assignee ?? "unassigned"}`,
    `Target agent: ${agent.name} (${agent.slug})`,
    ...(comment
      ? [`Comment author: ${comment.author}`, `Comment: ${comment.body}`]
      : []),
  ].join("\n");
}

export async function triggerAgent(
  input: {
    type: TriggerType;
    issue: Issue;
    agent: Agent;
    dedupeKey: string;
    comment?: Comment;
  },
  execute: (runId: string) => Promise<void> = executeRunInBackground,
) {
  try {
    const run = repository.transaction(() => {
      const eventId = workCoordinationStore.claimEvent({
        dedupeKey: input.dedupeKey,
        issueKey: input.issue.key,
        type: input.type,
        agentId: input.agent.id,
        commentId: input.comment?.id,
      });
      if (!eventId) return null;

      const thread = repository.getOrCreateWorkAgentThread(
        input.issue.key,
        input.agent.id,
        `${input.issue.key} · ${input.issue.title}`,
      );
      const mode =
        input.type === "assignment" || input.type === "resumed"
          ? "assignment"
          : "work_item";
      const created = createRunExecution({
        agentId: input.agent.id,
        threadId: thread.id,
        trigger: input.type,
        mode,
        issueKey: input.issue.key,
        prompt: coordinationInput(input),
        eventInstructions: coordinationInstructions(input),
      });
      repository.addRunEvent(created.id, "work_coordination_triggered", {
        issueKey: input.issue.key,
        issueVersion: input.issue.version,
        trigger: input.type,
        commentId: input.comment?.id ?? null,
      });
      workCoordinationStore.completeEvent(eventId, created.id);
      return created;
    });
    if (!run) return;
    void execute(run.id);
  } catch (error) {
    console.error(`[work-coordination] ${input.issue.key}:`, error);
    throw error;
  }
}

type InspectIssueDependencies = {
  dispatch?: typeof triggerAgent;
  listComments?: typeof WorkClient.listComments;
};

export async function inspectIssue(
  projectKey: string,
  issue: Issue,
  agents: Agent[],
  dependencies: InspectIssueDependencies = {},
) {
  const dispatch = dependencies.dispatch ?? triggerAgent;
  const listComments = dependencies.listComments ?? WorkClient.listComments;
  const previous = workCoordinationStore.getItem(issue.key);
  const assignedAgent = resolveAgent(agents, issue.assignee);
  const assigneeChanged =
    !previous ||
    identifier(previous.assignee as string | null) !==
      identifier(issue.assignee);

  if (
    assignedAgent?.enabled &&
    assigneeChanged &&
    (issue.status === "new" || issue.status === "in_progress")
  ) {
    await dispatch({
      type: "assignment",
      issue,
      agent: assignedAgent,
      dedupeKey: `assignment:${issue.key}:${assignedAgent.id}:${eventToken(issue)}`,
    });
  }

  const resumed =
    assignedAgent?.enabled &&
    issue.status === "in_progress" &&
    (String(previous?.semantic_status) === "blocked" ||
      String(previous?.semantic_status) === "review");
  if (resumed && assignedAgent) {
    await dispatch({
      type: "resumed",
      issue,
      agent: assignedAgent,
      dedupeKey: `resumed:${issue.key}:${assignedAgent.id}:${eventToken(issue)}`,
    });
  }

  const reviewer = resolveAgent(agents, getSetting("coordination_reviewer"));
  if (
    reviewer?.enabled &&
    issue.status === "review" &&
    reviewer.id !== assignedAgent?.id
  ) {
    await dispatch({
      type: "review_requested",
      issue,
      agent: reviewer,
      dedupeKey: `review:${issue.key}:${reviewer.id}:${eventToken(issue)}`,
    });
  }

  if (
    reviewer?.enabled &&
    issue.status === "blocked" &&
    reviewer.id !== assignedAgent?.id
  ) {
    await dispatch({
      type: "blocked",
      issue,
      agent: reviewer,
      dedupeKey: `blocked:${issue.key}:${reviewer.id}:${eventToken(issue)}`,
    });
  }

  let comments: Comment[] = [];
  try {
    comments = await listComments(issue.key);
  } catch (error) {
    console.error(`[work-coordination] comments ${issue.key}:`, error);
  }

  for (const comment of comments) {
    if (workCoordinationStore.hasSeenComment(comment.id)) continue;
    if (!previous) {
      workCoordinationStore.rememberComment(issue.key, comment.id);
      continue;
    }
    const targets = mentionedAgents(agents, comment);
    for (const target of targets) {
      const coveredByStateEvent =
        target.id === reviewer?.id &&
        (issue.status === "blocked" || issue.status === "review");
      if (coveredByStateEvent) continue;
      await dispatch({
        type: "mention",
        issue,
        agent: target,
        comment,
        dedupeKey: `mention:${comment.id}:${target.id}`,
      });
    }
    workCoordinationStore.rememberComment(issue.key, comment.id);
  }

  workCoordinationStore.observeItem({
    issueKey: issue.key,
    projectKey,
    assignee: issue.assignee ?? null,
    semanticStatus: issue.status,
    remoteUpdatedAt: issue.updated_at ?? null,
    labels: issue.labels ?? [],
  });
}

export function tickWorkCoordination() {
  if (state.slabWorkCoordinatorInFlight) {
    return state.slabWorkCoordinatorInFlight;
  }
  const tick = (async () => {
    try {
      const agents = repository.listAgents();
      if (!agents.some((agent) => agent.enabled)) return;
      const projects = await WorkClient.listProjects();
      for (const project of projects) {
        const issues = await WorkClient.listIssues(project.key);
        await mapWithConcurrency(issues, 6, (issue) =>
          inspectIssue(project.key, issue, agents),
        );
      }
    } catch (error) {
      console.error("[work-coordination] poll failed:", error);
    }
  })();
  state.slabWorkCoordinatorInFlight = tick;
  void tick.finally(() => {
    if (state.slabWorkCoordinatorInFlight === tick) {
      state.slabWorkCoordinatorInFlight = undefined;
    }
  });
  return tick;
}

state.slabWorkCoordinatorTick = tickWorkCoordination;

export function startWorkCoordinator() {
  state.slabWorkCoordinatorTick = tickWorkCoordination;
  if (state.slabWorkCoordinator) return;
  void state.slabWorkCoordinatorTick();
  state.slabWorkCoordinator = setInterval(
    () => void state.slabWorkCoordinatorTick?.(),
    15_000,
  );
  state.slabWorkCoordinator.unref();
}
