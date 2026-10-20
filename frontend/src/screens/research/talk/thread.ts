import type { Step } from "../conversation";
import type {
  ResearchEvent,
  ResearchJob,
  ResearchNode,
  ResearchPlan,
  ResearchSprint,
} from "../research-api";

/**
 * The project as one conversation, oldest first: what the researcher and the
 * advisor said, the plan cards, the work each sprint did (folded into one
 * block), the decisions waiting for the researcher, and where stages changed.
 */
export type ThreadItem =
  | { kind: "message"; id: string; who: string; text: string; at: string }
  | {
      kind: "plan";
      id: string;
      plan: ResearchPlan;
      /** The version on the table now (the newest, while scoping). */
      current: boolean;
      at: string;
    }
  | { kind: "stage"; id: string; to: string; note: string; at: string }
  | {
      /** What the system did on its own: a dataset fetched, the work paused. */
      kind: "notice";
      id: string;
      action: string;
      detail: Record<string, unknown>;
      failed: boolean;
      at: string;
    }
  | {
      kind: "work";
      id: string;
      sprint: ResearchSprint;
      steps: Step[];
      jobs: ResearchJob[];
      at: string;
    }
  | {
      kind: "decision";
      id: string;
      event: ResearchEvent;
      open: boolean;
      at: string;
    };

/** Bookkeeping that says nothing to the researcher. */
const HIDDEN = new Set([
  "sprint_planned",
  "create_project",
  "handoff_from_reply",
  "playbook_version",
  "human_decision",
  "budget_mark",
]);

const str = (value: unknown) => (typeof value === "string" ? value : "");

/** System steps said in the conversation itself, as one quiet line each. */
const NOTICES = new Set([
  "dataset_fetching",
  "dataset_ready",
  "dataset_failed",
]);

export function buildThread(
  events: ResearchEvent[],
  sprints: ResearchSprint[],
  jobs: ResearchJob[],
  nodes: ResearchNode[],
  stage: string,
  /** The plan as it stands now (an environment change updates it). */
  live?: ResearchPlan | Record<string, never> | null,
): ThreadItem[] {
  const bySprint = new Map(sprints.map((s) => [s.id, s]));
  const titles = new Map(nodes.map((n) => [n.id, n.title]));
  const answered = new Set(
    events
      .filter((e) => e.action === "human_decision")
      .map((e) => str(e.detail.request_id)),
  );
  const lastPlan = [...events]
    .reverse()
    .find((e) => e.action === "plan_proposed")?.id;
  const items: ThreadItem[] = [];
  const blocks = new Map<string, Extract<ThreadItem, { kind: "work" }>>();
  for (const event of events) {
    if (HIDDEN.has(event.action)) continue;
    const at = event.created_at;
    if (event.action === "message") {
      items.push({
        kind: "message",
        id: event.id,
        who: event.actor,
        text: str(event.detail.text),
        at,
      });
      continue;
    }
    if (event.action === "plan_proposed") {
      items.push({
        kind: "plan",
        id: event.id,
        plan:
          event.id === lastPlan &&
          live?.version === (event.detail.plan as ResearchPlan).version
            ? (live as ResearchPlan)
            : (event.detail.plan as ResearchPlan),
        current: event.id === lastPlan,
        at,
      });
      continue;
    }
    if (event.action === "stage_changed") {
      items.push({
        kind: "stage",
        id: event.id,
        to: str(event.detail.to),
        note: event.actor === "human" ? str(event.detail.note) : "",
        at,
      });
      continue;
    }
    if (
      NOTICES.has(event.action) ||
      (event.action === "paused" &&
        event.actor === "system" &&
        str(event.detail.reason))
    ) {
      items.push({
        kind: "notice",
        id: event.id,
        action: event.action,
        detail: event.detail,
        failed:
          event.action !== "dataset_fetching" &&
          event.action !== "dataset_ready",
        at,
      });
      continue;
    }
    if (event.action === "decision_requested") {
      items.push({
        kind: "decision",
        id: event.id,
        event,
        open: !answered.has(event.id),
        at,
      });
      continue;
    }
    const sprint = event.sprint_id ? bySprint.get(event.sprint_id) : undefined;
    const step: Step = {
      id: event.id,
      actor: event.actor,
      action: event.action,
      node:
        (event.node_id && titles.get(event.node_id)) || str(event.detail.title),
      detail: event.detail,
    };
    if (!sprint) {
      items.push({
        kind: "work",
        id: event.id,
        sprint: systemSprint(event),
        steps: [step],
        jobs: [],
        at,
      });
      continue;
    }
    let block = blocks.get(sprint.id);
    if (!block) {
      block = {
        kind: "work",
        id: sprint.id,
        sprint,
        steps: [],
        jobs: inOrder(jobs, sprint.id),
        at,
      };
      blocks.set(sprint.id, block);
      items.push(block);
    }
    block.steps.push(step);
  }
  // A sprint still at work before its first step shows as soon as it starts.
  for (const sprint of sprints) {
    if (sprint.status === "running" && !blocks.has(sprint.id))
      items.push({
        kind: "work",
        id: sprint.id,
        sprint,
        steps: [],
        jobs: inOrder(jobs, sprint.id),
        at: sprint.created_at,
      });
  }
  if (stage !== "scoping")
    for (const item of items) if (item.kind === "plan") item.current = false;
  return items;
}

/** A sprint's experiments in the order they started, like the steps above them. */
function inOrder(jobs: ResearchJob[], sprintId: string) {
  return jobs
    .filter((j) => j.sprint_id === sprintId)
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
}

function systemSprint(event: ResearchEvent): ResearchSprint {
  return {
    id: event.id,
    number: 0,
    role: event.actor,
    run_id: "",
    status: "ended",
    focus_node_id: null,
    summary: "",
    next_focus: "",
    waiting_on: [],
    tokens: 0,
    created_at: event.created_at,
    updated_at: event.created_at,
  };
}

/** Who is at work right now, if anyone: the advisor thinking, or a sprint running. */
export function working(sprints: ResearchSprint[]) {
  return sprints.find((s) => s.status === "running") ?? null;
}
