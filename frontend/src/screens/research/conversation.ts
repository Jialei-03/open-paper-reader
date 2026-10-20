import type {
  ResearchEvent,
  ResearchNode,
  ResearchSprint,
} from "./research-api";

/** One thing an agent (or the system, stepping in) did, and the node it was about. */
export interface Step {
  id: string;
  actor: string;
  action: string;
  node: string;
  detail: Record<string, unknown>;
}

/**
 * One turn of the exchange: a sprint by the executor, advisor or distiller with
 * what it did and handed over, or a note by the system between sprints.
 */
export interface Turn {
  key: string;
  role: string;
  number: number | null;
  steps: Step[];
  handoff: string;
  nextFocus: string;
}

/** Bookkeeping that says nothing about how the agents worked together. */
const HIDDEN = new Set([
  "sprint_planned",
  "create_project",
  "handoff_from_reply",
]);

/**
 * The project's record as an exchange between agents, oldest first. Steps are
 * grouped by the sprint they happened in; a block or decision by the system
 * during a sprint stays in that sprint, since it is part of that exchange.
 */
export function buildConversation(
  events: ResearchEvent[],
  sprints: ResearchSprint[],
  nodes: ResearchNode[],
): Turn[] {
  const bySprint = new Map(sprints.map((s) => [s.id, s]));
  const titles = new Map(nodes.map((n) => [n.id, n.title]));
  const turns: Turn[] = [];
  for (const event of events) {
    if (HIDDEN.has(event.action)) continue;
    const step: Step = {
      id: event.id,
      actor: event.actor,
      action: event.action,
      node:
        (event.node_id && titles.get(event.node_id)) ||
        (typeof event.detail.title === "string" ? event.detail.title : ""),
      detail: event.detail,
    };
    const sprint = event.sprint_id ? bySprint.get(event.sprint_id) : undefined;
    const last = turns[turns.length - 1];
    if (sprint && last?.key === sprint.id) {
      last.steps.push(step);
    } else if (sprint) {
      turns.push({
        key: sprint.id,
        role: sprint.role,
        number: sprint.number,
        steps: [step],
        handoff: sprint.summary ?? "",
        nextFocus: sprint.next_focus ?? "",
      });
    } else {
      turns.push({
        key: event.id,
        role: "system",
        number: null,
        steps: [step],
        handoff: "",
        nextFocus: "",
      });
    }
  }
  return turns;
}
