import { api, send } from "../../api";
import type { MessageKey } from "../../i18n/i18n";

export type StepType = "agent" | "plan" | "experiment" | "review";
export interface WorkflowStep {
  name: string;
  type: StepType;
  instructions: string;
  outputs: string[];
  confirmation: boolean;
  max_rounds: number | null;
  action?: "child_research" | "conclusion" | "retrospective" | null;
  max_retries: number;
}
export interface StepState {
  status:
    | "pending"
    | "running"
    | "waiting"
    | "completed"
    | "rejected"
    | "blocked";
  summary: string;
  outputs: string[];
  started_at?: string | null;
  finished_at?: string | null;
  commit_sha?: string;
}
export interface Workflow {
  id: string;
  name: string;
  version: number;
  builtin: boolean;
  steps: WorkflowStep[];
  state?: { current: number; steps: StepState[] };
}
export interface WorkflowInput {
  name: string;
  version?: number;
  steps: WorkflowStep[];
}
const base = "/research/workflows";
export const readWorkflows = () => api<Workflow[]>(base);
export const createWorkflow = (body: WorkflowInput) =>
  send(base, body) as Promise<Workflow>;
export const updateWorkflow = (id: string, body: WorkflowInput) =>
  send(`${base}/${id}`, body, "PUT") as Promise<Workflow>;
export const deleteWorkflow = (id: string) =>
  send(`${base}/${id}`, undefined, "DELETE");
const BUILTIN_NAMES: Record<string, MessageKey> = {
  research: "workflows.builtin.research",
  "literature-review": "workflows.builtin.literature",
  reproduction: "workflows.builtin.reproduction",
  "paper-writing": "workflows.builtin.writing",
  "read-to-write": "workflows.builtin.readToWrite",
};
const LITERATURE: MessageKey[] = [
  "workflows.step.collect",
  "workflows.step.read",
  "workflows.step.synthesize",
  "workflows.type.review",
];
const WRITING: MessageKey[] = [
  "workflows.step.outline",
  "workflows.step.draft",
  "workflows.step.selfReview",
];
const STEP_NAMES: Record<string, MessageKey[]> = {
  research: [
    "research.stage.scoping",
    "research.stage.experiments",
    "research.stage.conclusion",
    "research.stage.retrospective",
  ],
  "literature-review": LITERATURE,
  reproduction: [
    "workflows.step.selectPaper",
    "workflows.step.reproduce",
    "workflows.step.compare",
  ],
  "paper-writing": WRITING,
  "read-to-write": [
    ...LITERATURE,
    "workflows.step.ideas",
    "workflows.builtin.research",
    ...WRITING,
  ],
};
export const workflowName = (item: Workflow, t: (key: MessageKey) => string) =>
  item.builtin && BUILTIN_NAMES[item.id]
    ? t(BUILTIN_NAMES[item.id])
    : item.name;
export const stepName = (
  item: Workflow,
  index: number,
  t: (key: MessageKey) => string,
) =>
  item.builtin && STEP_NAMES[item.id]?.[index]
    ? t(STEP_NAMES[item.id][index])
    : item.steps[index]?.name || "";
export function moveStep<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length)
    return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
