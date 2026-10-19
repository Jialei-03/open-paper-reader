import { api, send } from "../../api";

/** A research project as the service lists it (backend research_routes.py). */
export interface ResearchProject {
  id: string;
  question: string;
  background: string;
  model_config_id: string;
  status: "active" | "waiting" | "paused" | "finished";
  end_reason: "" | "concluded" | "refuted" | "budget" | "stopped";
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
