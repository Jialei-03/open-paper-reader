import { api, send } from "../../api";

/** A research project as the service lists it (backend research_routes.py). */
export interface ResearchProject {
  id: string;
  question: string;
  background: string;
  model_config_id: string;
  status: "active" | "waiting" | "paused" | "finished";
  end_reason: "" | "concluded" | "refuted" | "blocked" | "budget" | "stopped";
  budget: { max_sprints: number; max_tokens: number; max_job_seconds: number };
  spent: { sprints: number; tokens: number; job_seconds: number };
  session_id: string;
  created_at: string;
  updated_at: string;
}

export type NodeKind = "question" | "hypothesis" | "experiment" | "finding";
export type NodeStatus =
  | "open"
  | "active"
  | "supported"
  | "refuted"
  | "abandoned"
  | "parked";

export type Evidence =
  | {
      kind: "log";
      job_id: string;
      from_line: number;
      to_line: number;
      lines: string[];
    }
  | {
      kind: "cite";
      file_id: string;
      paper_id: string | null;
      page: number;
      quote: string;
    };

export interface ResultEntry {
  summary: string;
  evidence: Evidence[];
  kill_triggered: "yes" | "no" | "unsure";
  sprint_id: string;
  at: string;
}

export interface ResearchNode {
  id: string;
  parent_id: string | null;
  kind: NodeKind;
  title: string;
  status: NodeStatus;
  confidence: number;
  kill_if: string;
  budget_tokens: number;
  /** Estimates: what working on it may teach, and what it costs ("" when none). */
  value: "" | "high" | "medium" | "low";
  cost: "" | "high" | "medium" | "low";
  evidence_for: ResultEntry[];
  evidence_against: ResultEntry[];
  doubts: string[];
  spent_tokens: number;
  spent_job_seconds: number;
  created_at: string;
  updated_at: string;
}

export interface ResearchSprint {
  id: string;
  number: number;
  role: string;
  run_id: string;
  status: "running" | "ended" | "abnormal";
  focus_node_id: string | null;
  summary: string;
  next_focus: string;
  waiting_on: string[];
  tokens: number;
  created_at: string;
  updated_at: string;
}

export interface ResearchJob {
  id: string;
  node_id: string;
  sprint_id: string;
  command: string;
  status: "running" | "succeeded" | "failed" | "timeout" | "lost";
  exit_code: number | null;
  timeout_seconds: number;
  started_at: string;
  finished_at: string;
  log_lines: number;
}

export interface ProjectDetail {
  project: ResearchProject;
  nodes: ResearchNode[];
  sprints: ResearchSprint[];
  jobs: ResearchJob[];
  docker: { available: boolean; reason: string };
  /** What the advisor said the project waits for (a file, a definition); "" otherwise. */
  input_needed: string;
}

export interface LogLines {
  lines: { n: number; text: string }[];
  total: number;
}

const BASE = "/research/projects";

export const listProjects = () => api<ResearchProject[]>(BASE);

export const getProject = (id: string, signal?: AbortSignal) =>
  api<ProjectDetail>(`${BASE}/${id}`, { signal });

export const createProject = (body: {
  question: string;
  background?: string;
  model_config_id: string;
  budget?: Partial<ResearchProject["budget"]>;
}) => send(BASE, body) as Promise<ResearchProject>;

const move = (id: string, action: "pause" | "resume" | "stop") =>
  send(`${BASE}/${id}/${action}`, {}) as Promise<ResearchProject>;

export const pauseProject = (id: string) => move(id, "pause");
export const resumeProject = (id: string) => move(id, "resume");
export const stopProject = (id: string) => move(id, "stop");

export const jobLog = (projectId: string, jobId: string, offset = 0) =>
  api<LogLines>(`${BASE}/${projectId}/jobs/${jobId}/log?offset=${offset}`);

/** Something the advisor asked a person to decide (backend research_routes.py `decisions`). */
export interface Decision {
  id: string;
  node_id: string | null;
  sprint_id: string | null;
  detail: {
    node_id: string;
    proposal: "continue" | "invest" | "kill" | "pivot";
    reason: string;
    new_hypothesis?: { title: string; kill_if: string } | null;
  };
  created_at: string;
  open: boolean;
}

export const listDecisions = (projectId: string) =>
  api<Decision[]>(`${BASE}/${projectId}/decisions`);

export const decide = (
  projectId: string,
  decisionId: string,
  approve: boolean,
  note: string,
) =>
  send(`${BASE}/${projectId}/decisions/${decisionId}`, {
    approve,
    note,
  }) as Promise<ResearchProject>;

/** How the project went, from its record (backend research_metrics.py). */
export interface ProjectMetrics {
  sprints: { executor: number; advisor: number };
  hard_drift_blocks: number;
  soft_drift_rate: number | null;
  backtrack_latency: number | null;
  abnormal_rate: number | null;
  evidence_count: number;
  tokens_per_supported: number | null;
  tokens: number;
}

export const projectMetrics = (projectId: string) =>
  api<ProjectMetrics>(`${BASE}/${projectId}/metrics`);

export interface WorkspaceFile {
  path: string;
  size: number;
}

export const listFiles = (projectId: string) =>
  api<WorkspaceFile[]>(`${BASE}/${projectId}/files`);

/** A data file for the experiments; the agent finds it at /work/data/<name>. */
export function uploadFile(projectId: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  return api<WorkspaceFile>(`${BASE}/${projectId}/files`, {
    method: "POST",
    body,
  });
}
