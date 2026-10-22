import { api, send } from "../../api";
import type { Workflow } from "../workflows/workflows-api";
import type { RunStep } from "./process/model";

/** A research project as the service lists it (backend research_routes.py). */
export interface ResearchProject {
  id: string;
  question: string;
  title?: string;
  collection_id?: string | null;
  on_board?: boolean;
  pinned_at?: string | null;
  location?: {
    kind: "local" | "ssh" | "managed";
    path: string;
    connection_id: string;
  };
  background: string;
  model_config_id: string;
  status: "active" | "waiting" | "paused" | "finished";
  end_reason: "" | "concluded" | "refuted" | "blocked" | "budget" | "stopped";
  /** A limit left empty (null) is no limit. */
  budget: {
    max_sprints: number | null;
    max_tokens: number | null;
    max_job_seconds: number | null;
  };
  spent: { sprints: number; tokens: number; job_seconds: number };
  session_id: string;
  workspace_id: string;
  stage: Stage;
  workflow?: Workflow;
  compute_id: string;
  plan: ResearchPlan | Record<string, never>;
  conclusion_record: ConclusionRecord | Record<string, never>;
  /** What each compute offered when the project first ran on it. */
  environment: Record<string, Environment>;
  created_at: string;
  updated_at: string;
  /** How a finished project was answered (the list only); "" otherwise. */
  conclusion?: string;
  parent_id?: string | null;
  forked_from?: ResearchForkSource | Record<string, never>;
  merged?: ResearchMerged | Record<string, never>;
  capabilities?: { fork?: boolean };
}

export interface ResearchForkSource {
  research_id: string;
  source_session_id: string;
  sprint_id: string;
  number: number;
  commit: string;
  change: string;
  at: string;
  question?: string;
}
export interface ResearchMerged {
  memory?: {
    merge_id: string;
    commit_sha: string;
    paths: string[];
    at: string;
  };
  code?: { merge_id: string; commit_sha: string; paths: string[]; at: string };
}

export type Stage =
  | "scoping"
  | "experiments"
  | "conclusion"
  | "retrospective"
  | "done"
  | "workflow";

export const STAGES: Stage[] = [
  "scoping",
  "experiments",
  "conclusion",
  "retrospective",
  "done",
];

/** The plan talked through while scoping (backend research_stages.py check_plan). */
export interface ResearchPlan {
  version: number;
  question: string;
  goal: string;
  metric: string;
  baseline: string;
  hypotheses: {
    title: string;
    kill_if: string;
    value: string;
    cost: string;
  }[];
  datasets: string[];
  compute_id: string;
  budget: { max_sprints: number | null; max_job_hours: number | null };
  summary: string;
  approved_at: string | null;
  inherited?: boolean;
}

export interface ConclusionRecord {
  status: "concluded" | "refuted";
  answer: string;
  summary: string;
  proposed_at: string;
  accepted: boolean | null;
  note: string;
  decided_at?: string;
}

/** What the probe found on a compute (backend research_ora/probe.py). */
export interface Environment {
  python?: string;
  platform?: string;
  machine?: string;
  cpus?: number;
  memory_gb?: number;
  packages?: Record<string, string>;
  gpus?: string[];
  cuda?: boolean;
  mps?: boolean;
  image?: string;
  host?: string;
  compute?: Record<string, unknown>;
  probed_at?: string;
}

export interface Dataset {
  id: string;
  name: string;
  title: string;
  source: "registry" | "upload";
  path: string;
  status: "pending" | "ready" | "failed";
  files: { name: string; bytes: number; md5?: string; sha256: string }[];
  bytes: number;
  note: string;
  created_at: string;
}

export type NodeKind = "question" | "hypothesis" | "experiment" | "finding";
export type NodeStatus =
  | "open"
  | "active"
  | "supported"
  | "refuted"
  | "abandoned"
  | "parked";

export type Evidence = {
  source_research_id?: string;
  source_log_url?: string;
} & (
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
    }
);

export interface ResultEntry {
  source_research_id?: string;
  source_node_id?: string;
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
  project_id?: string;
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
  commit_sha?: string;
}

export interface ResearchJob {
  id: string;
  node_id: string;
  sprint_id: string;
  command: string;
  status:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "timeout"
    | "lost"
    | "cancelled";
  /** While queued: 1 for the next to start on its machine (this machine runs them in turn). */
  queue_position?: number;
  exit_code: number | null;
  timeout_seconds: number;
  started_at: string;
  finished_at: string;
  log_lines: number;
  compute_id: string;
  config: Record<string, unknown>;
  metrics: Record<string, unknown>;
  points: number;
  /** "" not yet mirrored, "none", an address, "local:<folder>", or "error: …". */
  tracker_url: string;
}

export interface ProjectDetail {
  project: ResearchProject;
  nodes: ResearchNode[];
  sprints: ResearchSprint[];
  jobs: ResearchJob[];
  docker: { available: boolean; reason: string };
  /** What the advisor said the project waits for (a file, a definition); "" otherwise. */
  input_needed: string;
  datasets: Dataset[];
  inherited_history?: { events: ResearchEvent[]; sprints: ResearchSprint[] };
}

export interface LogLines {
  lines: { n: number; text: string }[];
  total: number;
}

const BASE = "/research/projects";

export const listProjects = () => api<ResearchProject[]>(BASE);

export const getProject = (id: string, signal?: AbortSignal) =>
  api<ProjectDetail>(`${BASE}/${id}`, { signal });

/** A project starts from what the researcher says; the plan is talked through. */
export const startProject = (body: {
  defer_start?: boolean;
  workflow_id?: string;
  message: string;
  model_config_id: string;
  compute_id?: string;
  workspace_id?: string;
  collection_id?: string | null;
}) => send(BASE, body) as Promise<ResearchProject>;

export const sendMessage = (id: string, text: string) =>
  send(`${BASE}/${id}/messages`, { text }) as Promise<ResearchProject>;

/** The researcher restates the question; the note says why (agents read it). */
export const restateQuestion = (id: string, question: string, note: string) =>
  send(`${BASE}/${id}/question`, {
    question,
    note,
  }) as Promise<ResearchProject>;

/** Where the next experiments run; a running job stays where it is. */
export const moveModel = (id: string, model_config_id: string) =>
  send(`${BASE}/${id}/model`, { model_config_id });
export const moveCompute = (id: string, compute_id: string) =>
  send(`${BASE}/${id}/compute`, { compute_id }) as Promise<ResearchProject>;

/** Each recent round's run with its steps (what the thread shows inline). */
export const listRuns = (projectId: string) =>
  api<import("./process/model").ResearchRun[]>(`${BASE}/${projectId}/runs`);

export const approvePlan = (id: string, version: number, note = "") =>
  send(`${BASE}/${id}/plan/approve`, {
    version,
    note,
  }) as Promise<ResearchProject>;

export interface SeriesPoint {
  step: number | null;
  t: number;
  [metric: string]: unknown;
}

export const jobSeries = (projectId: string, jobId: string) =>
  api<SeriesPoint[]>(`${BASE}/${projectId}/jobs/${jobId}/series`);

export interface Compute {
  /** Whether experiments can be sent there now (client-side, from its state). */
  ready?: boolean;
  id: string;
  name: string;
  kind: "host" | "docker" | "ssh";
  gpus: string;
  cpus?: number;
  memory_gb?: number;
  host?: string;
  remote_dir?: string;
  runner?: "shell" | "docker";
  python?: string;
  /** This machine: how many experiments run at once; more wait their turn (default 1). */
  concurrency?: number;
}

export interface ResearchSettings {
  computes: Compute[];
  default_compute: string;
  tracker: {
    kind: "none" | "swanlab" | "wandb";
    mode: "local" | "cloud";
    project: string;
    entity?: string;
    has_key: boolean;
  };
  datasets?: { name: string; title: string }[];
  /** What checking each environment found (backend research_environment.py). */
  states: Record<string, EnvState>;
}

export interface EnvState {
  status?: "connected" | "disconnected";
  error?: string;
  checked_at?: string;
  /** A Python an earlier version prepared, still in use. */
  python?: string;
  probe?: Environment;
}

export interface SshHost {
  name: string;
  hostname: string;
  user: string;
}

export const sshHosts = () => api<SshHost[]>("/research/ssh-hosts");

export const checkEnvironment = (id: string) =>
  send(`/research/environments/${id}/check`, {}) as Promise<EnvState>;

export const readResearchSettings = () =>
  api<ResearchSettings>("/research/settings").then((s) => ({
    ...s,
    // Nothing is prepared: an environment is usable unless its last check
    // could not reach it.
    computes: s.computes.map((c) => ({
      ...c,
      ready: s.states?.[c.id]?.status !== "disconnected",
    })),
  }));

export const saveResearchSettings = (
  body: Partial<Omit<ResearchSettings, "tracker">> & {
    tracker?: Partial<ResearchSettings["tracker"]> & {
      api_key?: string;
      clear_key?: boolean;
    };
  },
) => send("/research/settings", body, "PUT") as Promise<ResearchSettings>;

export const testCompute = (id: string) =>
  send(`/research/computes/${id}/test`, {}) as Promise<Environment>;

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

/** The project's report as a Markdown file; the browser downloads it. */
export const reportUrl = (id: string, lang: "zh" | "en") =>
  `/api/v1${BASE}/${id}/report?lang=${lang}`;

/** One step in a project's record: who did what, to which node, in which sprint. */
export interface ResearchEvent {
  id: string;
  node_id: string | null;
  sprint_id: string | null;
  actor: "executor" | "advisor" | "distiller" | "system" | string;
  action: string;
  detail: Record<string, unknown>;
  created_at: string;
}

/** The whole record, oldest first (the service pages it 200 at a time). */
export async function listEvents(projectId: string): Promise<ResearchEvent[]> {
  const all: ResearchEvent[] = [];
  for (;;) {
    const after = all.length ? all[all.length - 1].created_at : "";
    const page = await api<ResearchEvent[]>(
      `${BASE}/${projectId}/events${after ? `?after=${encodeURIComponent(after)}` : ""}`,
    );
    all.push(...page);
    if (page.length < 200) return all;
  }
}

export const jobLog = (projectId: string, jobId: string, offset = 0) =>
  api<LogLines>(`${BASE}/${projectId}/jobs/${jobId}/log?offset=${offset}`);

/** Something the advisor asked a person to decide (backend research_routes.py `decisions`). */
export interface Decision {
  id: string;
  node_id: string | null;
  sprint_id: string | null;
  detail: {
    node_id: string;
    /** plan and conclusion are the stage gates; the rest are the advisor's proposals. */
    kind?: "plan" | "conclusion";
    status?: "concluded" | "refuted";
    proposal: "continue" | "invest" | "kill" | "pivot" | "accept_conclusion";
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

/** A project: researches pursued together, and what they share. */
export interface Workspace {
  location?: {
    kind: "local" | "ssh" | "managed";
    path: string;
    connection_id: string;
  };
  id: string;
  name: string;
  description: string;
  instructions: string;
  kind: "research" | "eval";
  compute_id: string;
  model_config_id: string;
  session_id?: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceRow extends Workspace {
  researches: number;
  running: number;
  waiting: number;
  ideas: number;
  active_at: string;
}

export type Column =
  | "triage"
  | "todo"
  | "running"
  | "review"
  | "done"
  | "dropped";

/** A research as a project lists it. */
export interface ResearchSummary {
  title?: string;
  session_id?: string;
  workspace_id?: string;
  collection_id?: string | null;
  on_board?: boolean;
  pinned_at?: string | null;
  id: string;
  question: string;
  stage: Stage;
  status: ResearchProject["status"];
  end_reason: string;
  column: Column;
  rounds: number;
  best: { name: string; value: number } | null;
  working: string;
  waiting: number;
  compute_id: string;
  updated_at: string;
  /** False while it is a conversation with no plan yet. */
  planned?: boolean;
  hypotheses?: Record<"supported" | "refuted" | "abandoned" | "open", number>;
  experiments?: number;
  tokens?: number;
  conclusion?: string;
  said?: string;
  progress?: string;
  parent_id?: string | null;
  forked_from?: ResearchForkSource | Record<string, never>;
  merged?: ResearchMerged | Record<string, never>;
}

export interface RecentResearch extends ResearchSummary {
  workspace_id: string;
  workspace: string;
}

export const recentResearches = (limit = 6) =>
  api<RecentResearch[]>(`/research/recent?limit=${limit}`);

export interface BoardCard {
  id: string;
  kind: "research" | "hypothesis" | "experiment" | "finding" | "idea";
  title: string;
  summary: string;
  column: Column;
  movable: boolean;
  research: { id: string; question: string } | null;
  working: string;
  best?: { name: string; value: number } | null;
  evidence?: number;
  status?: string;
  stage?: Stage;
  updated_at: string;
}

const WS = "/research/workspaces";

export const listWorkspaces = () => api<WorkspaceRow[]>(WS);
export const createWorkspace = (name: string, description = "") =>
  send(WS, { name, description }) as Promise<Workspace>;
export const getWorkspace = (id: string) =>
  api<Workspace & { researches: ResearchSummary[] }>(`${WS}/${id}`);
export interface ResearchNote {
  id: string;
  workspace_id: string;
  project_id: string;
  kind: "plan" | "decision" | "conclusion" | "error" | "fork" | "merged";
  text: string;
  created_at: string;
  pending?: boolean;
  resolved?: boolean;
  status?: "pending" | "resolved" | "historical";
}
export const workspaceNotes = (id: string) =>
  api<ResearchNote[]>(`${WS}/${id}/notes`);
export const updateWorkspace = (id: string, body: Partial<Workspace>) =>
  send(`${WS}/${id}`, body, "PATCH") as Promise<Workspace>;
export const getBoard = (id: string) =>
  api<{ columns: Column[]; cards: BoardCard[] }>(`${WS}/${id}/board`);
export const addCard = (id: string, title: string, body = "") =>
  send(`${WS}/${id}/cards`, { title, body });
export const moveCard = (cardId: string, status: Column) =>
  send(`/research/cards/${cardId}`, { status }, "PATCH");
export const startCard = (cardId: string, model_config_id = "") =>
  send(`/research/cards/${cardId}/start`, {
    model_config_id,
  }) as Promise<ResearchProject>;

/** A conversation inside a project (backend research_chat.py). */
export interface ProjectChat {
  id: string;
  title: string;
  workspace_id: string;
  /** The model the conversation goes on with; null: the project's default. */
  model_config_id?: string | null;
  created_at: string;
  updated_at: string;
}

/** One question and its answer, as the agent session stores it. */
export interface ChatTurn {
  id: string;
  prompt: string;
  status: string;
  response: string;
  error: string;
  steps: RunStep[];
  runtime: {
    phase?: string;
    execution_seconds?: number;
    /** "/compact": this turn summarized the conversation instead of answering. */
    command?: "compact";
    instructions?: string;
    compaction?: { reason?: string; error?: string; tokens_before?: number };
    /** How full the conversation's context was after this turn (Pi's count). */
    context?: { tokens?: number | null; contextWindow?: number };
    conversation_messages?: {
      id: string;
      role: "user" | "assistant";
      text: string;
      control_id?: string;
    }[];
  };
  model_config_id?: string;
  created_at: string;
  updated_at: string;
}

export const listChats = (workspaceId: string) =>
  api<ProjectChat[]>(`${WS}/${workspaceId}/chats`);
export const startChat = (workspaceId: string, message: string) =>
  send(`${WS}/${workspaceId}/chats`, { message }) as Promise<ProjectChat>;
export const askChat = (
  chatId: string,
  message: string,
  extra: { model_config_id?: string; command?: "compact" } = {},
) =>
  send(`/research/chats/${chatId}/messages`, {
    message,
    ...extra,
  }) as Promise<ProjectChat>;
export const cloneChat = (chatId: string) =>
  send(`/research/chats/${chatId}/clone`, {}) as Promise<ProjectChat>;
export const renameChat = (chatId: string, title: string) =>
  send(`/agent/sessions/${chatId}`, { title }, "PATCH");
export const chatTurns = (chatId: string) =>
  api<ChatTurn[]>(`/agent/sessions/${chatId}/runs`);

export interface SessionCapabilities {
  send: boolean;
  coordinate: boolean;
  rename: boolean;
  pin: boolean;
  archive: boolean;
  delete: boolean;
  clone: boolean;
  compact: boolean;
  steer: boolean;
}

export interface ProjectSession extends ProjectChat {
  kind:
    | "project_lead"
    | "project_chat"
    | "research"
    | "paper"
    | "chat"
    | "artifact";
  research_id: string | null;
  question: string;
  source_session_id: string | null;
  source_run_id: string | null;
  pinned_at: string | null;
  archived_at: string | null;
  status: string;
  active_run_id?: string | null;
  last_run_status?: string | null;
  stage?: Stage;
  progress: string;
  capabilities: SessionCapabilities;
  parent_id?: string | null;
  forked_from?: ResearchForkSource | Record<string, never>;
  merged?: ResearchMerged | Record<string, never>;
}

export interface ForkRound {
  sprint_id: string;
  number: number;
  role: string;
  status: string;
  commit_sha: string;
  available: boolean;
  reason: string;
}
export const forkOptions = (projectId: string) =>
  api<{ can_fork: boolean; reason: string; rounds: ForkRound[] }>(
    `${BASE}/${projectId}/forks/options`,
  );
export const forkResearch = (
  projectId: string,
  body: {
    sprint_id: string;
    expected_commit: string;
    change: string;
    client_id: string;
  },
) => send(`${BASE}/${projectId}/forks`, body) as Promise<ResearchProject>;

export type MergeKind = "memory" | "code";
export interface MergeFile {
  path: string;
  status: string;
  diff: string;
  binary?: boolean;
  truncated?: boolean;
}
export interface ResearchMerge {
  target_location?: {
    kind: "local" | "ssh" | "managed";
    path: string;
    connection_id?: string;
    host?: string;
    port?: number;
  } | null;
  id: string;
  kind: MergeKind;
  status: "preview" | "conflict" | "applied" | "cancelled" | "failed";
  expected_main_commit: string;
  expected_source_commit: string;
  files: MergeFile[];
  paths: string[];
  memory_text?: string;
  conflicts: { path: string; diff: string }[];
  commit_sha: string;
  error: string;
  created_at: string;
  research_id?: string;
  project_id?: string;
  question?: string;
}
export const mergeOptions = (projectId: string) =>
  api<{
    memory: boolean;
    code: boolean;
    reason: string;
    memory_reason?: string;
    code_reason?: string;
  }>(`${BASE}/${projectId}/merge-options`);
export const researchMerges = (projectId: string) =>
  api<ResearchMerge[]>(`${BASE}/${projectId}/merges`);
export const previewMerge = (
  projectId: string,
  kind: MergeKind,
  paths?: string[],
) =>
  send(`${BASE}/${projectId}/merge-preview`, {
    kind,
    ...(paths ? { paths } : {}),
  }) as Promise<ResearchMerge>;
export const applyMerge = (projectId: string, preview: ResearchMerge) =>
  send(`${BASE}/${projectId}/merges/${preview.id}/apply`, {
    expected_main_commit: preview.expected_main_commit,
    expected_source_commit: preview.expected_source_commit,
  }) as Promise<ResearchMerge>;
export const cancelMerge = (projectId: string, mergeId: string) =>
  send(
    `${BASE}/${projectId}/merges/${mergeId}/cancel`,
    {},
  ) as Promise<ResearchMerge>;
export interface ProjectMemory {
  path: string;
  research_id: string;
  title: string;
  commit_sha: string;
  merge_commit_sha?: string;
  updated_at: string;
  text: string;
}
export const projectMemories = (workspaceId: string) =>
  api<ProjectMemory[]>(`${WS}/${workspaceId}/memory`);
export const projectMerges = (workspaceId: string) =>
  api<ResearchMerge[]>(`${WS}/${workspaceId}/merges`);

export const listProjectSessions = (
  workspaceId: string,
  options: { search?: string; cursor?: string; archived?: boolean } = {},
) => {
  const query = new URLSearchParams({ limit: "40" });
  if (options.search) query.set("search", options.search);
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.archived) query.set("archived", "true");
  return api<{ items: ProjectSession[]; next_cursor: string | null }>(
    `${WS}/${workspaceId}/sessions?${query}`,
  );
};
export const createProjectChat = (workspaceId: string) =>
  send(`${WS}/${workspaceId}/sessions`, {}) as Promise<ProjectSession>;
export const getChatSession = (sessionId: string) =>
  api<ProjectSession>(`/agent/sessions/${sessionId}`);
export const updateChatSession = (
  sessionId: string,
  body: { title?: string; pinned?: boolean; archived?: boolean },
) =>
  send(
    `/agent/sessions/${sessionId}`,
    body,
    "PATCH",
  ) as Promise<ProjectSession>;

export interface ChatControl {
  id: string;
  session_id: string;
  run_id: string;
  kind: "steer" | "follow_up" | "abort";
  text: string;
  status: "queued" | "accepted" | "applied" | "rejected";
  error: string;
  created_at: string;
  updated_at: string;
}
export const chatControls = (sessionId: string, runId?: string) =>
  api<ChatControl[]>(
    `/agent/sessions/${sessionId}/controls${runId ? `?run_id=${encodeURIComponent(runId)}` : ""}`,
  );
export const controlChat = (
  sessionId: string,
  runId: string,
  kind: ChatControl["kind"],
  text = "",
) =>
  send(`/agent/sessions/${sessionId}/controls`, {
    expected_run_id: runId,
    kind,
    text,
    client_id: crypto.randomUUID(),
  }) as Promise<ChatControl>;

export interface CheckpointChanges {
  base_commit?: string;
  commit_sha?: string;
  added: number;
  removed: number;
  can_undo?: boolean;
  files: {
    path: string;
    added: number;
    removed: number;
    diff: string;
    truncated?: boolean;
    binary?: boolean;
  }[];
}
export const readChanges = (id: string, sprintId?: string) =>
  api<CheckpointChanges>(
    `${BASE}/${id}${sprintId ? `/rounds/${sprintId}` : ""}/changes`,
  );
export const undoRound = (
  id: string,
  sprintId: string,
  expected_commit: string,
) => send(`${BASE}/${id}/rounds/${sprintId}/undo`, { expected_commit });
export const markResearchRead = (id: string, event_id: string) =>
  send(`${BASE}/${id}/read`, { event_id });
