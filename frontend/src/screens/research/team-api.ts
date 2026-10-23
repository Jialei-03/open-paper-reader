import type {
  Workflow,
  WorkflowRuntime,
} from "../team/workflow/workflow-model";
import { api, send } from "../../api";
import type { ResearchRun } from "./process/model";

export interface MemberPermissions {
  papers: boolean;
  files: boolean;
  commands: boolean;
  machines: string[];
  readonly: boolean;
  file_readonly?: boolean;
}
export interface MemberConfig {
  name: string;
  description?: string;
  tools?: string[] | null;
  wake_minutes?: number;
  avatar_color: string;
  role_description: string;
  model_config_id: string;
  permissions: MemberPermissions;
  wake_turns: number;
  wake_tokens: number;
}
export interface AgentDocument {
  source: string;
  config: MemberConfig & { channels?: string[] };
  warnings: string[];
}
export interface AgentFile {
  source?: string;
  revision?: string;
  file_path?: string;
  file_error?: string;
}
export interface LibraryMember extends AgentFile {
  id: string;
  version: number;
  config: MemberConfig;
  teams: string[];
}
export interface TeamMember extends Partial<MemberConfig>, AgentFile {
  library_id?: string | null;
  builtin?: boolean;
  enabled?: boolean;
  deleted?: boolean;
  subscriptions?: string[];
  overrides?: string[];
  tokens?: number;
  max_tokens?: number;
  id: string;
  role: string;
  name: string;
  status: "idle" | "working" | "waiting";
  active_run_id: string | null;
}
export interface TeamChannel {
  id: string;
  key: string;
  name: string;
  member_id: string | null;
  unread: number;
}
export interface TeamMessage {
  id: string;
  channel_id: string;
  thread_id: string | null;
  author_id: string | null;
  text: string;
  kind: string;
  mentions: string[];
  data: {
    rule?: string;
    workflow?: string;
    workflow_version?: number;
    waiting?: boolean;
    research_id?: string;
    title?: string;
    research_forwarded?: boolean;
    attachments?: { id: string; name: string; url: string }[];
    files?: { path: string; name: string }[];
    links?: { channel_id: string; thread_id: string; name: string }[];
    file_error?: string;
    reason?: string;
    limit?: number;
  };
  created_at: string;
  replies: number;
  run?: Omit<ResearchRun, "role">;
}
export interface Team {
  workspace_id: string;
  members: TeamMember[];
  channels: TeamChannel[];
  notifications: TeamMessage[];
  workflow?: Workflow;
  runtime?: WorkflowRuntime;
  budget?: TeamBudget;
  tokens?: number;
}
export interface TeamBudget {
  max_tokens: number;
  period_hours: number;
  max_concurrent: number;
}
export interface Delivery {
  id: string;
  member_id: string;
  message_id: string;
  channel_id: string;
  thread_id: string | null;
  text: string;
  mode: "queue" | "immediate";
  status: string;
  error: string;
  editable: boolean;
}
const base = (id: string) => `/research/workspaces/${id}/team`;
export const getTeam = (id: string) => api<Team>(base(id));
export const saveTeamBudget = (id: string, budget: TeamBudget) =>
  send(`${base(id)}/budget`, budget, "PUT");
export const getMessages = (id: string, channel: string, thread?: string) =>
  api<{
    messages: TeamMessage[];
    root: TeamMessage | null;
    research_id: string | null;
  }>(
    `${base(id)}/channels/${channel}/messages${thread ? `?thread_id=${encodeURIComponent(thread)}` : ""}`,
  );
export const sendTeamMessage = (
  id: string,
  channel: string,
  body: {
    text: string;
    thread_id?: string;
    mode: "queue" | "immediate";
    model_config_id?: string;
    client_id: string;
    attachment_ids?: string[];
  },
) =>
  send(
    `${base(id)}/channels/${channel}/messages`,
    body,
  ) as Promise<TeamMessage>;
export const getDeliveries = (id: string) =>
  api<Delivery[]>(`${base(id)}/deliveries`);
export const continueTeamMessage = (id: string, message: string) =>
  send(`${base(id)}/messages/${message}/continue`, {});
export const editDelivery = (
  id: string,
  delivery: string,
  body: { text?: string; mode?: "queue" | "immediate"; cancel?: boolean },
) => send(`${base(id)}/deliveries/${delivery}`, body, "PATCH");
export const createChannel = (id: string, name: string) =>
  send(`${base(id)}/channels`, { name });
export const renameChannel = (id: string, channel: string, name: string) =>
  send(`${base(id)}/channels/${channel}`, { name }, "PATCH");
export const deleteChannel = (id: string, channel: string) =>
  send(`${base(id)}/channels/${channel}`, {}, "DELETE");
export const readChannel = (
  id: string,
  channel: string,
  through: string,
  thread_id?: string,
) =>
  send(`${base(id)}/channels/${channel}/read`, {
    through,
    ...(thread_id ? { thread_id } : {}),
  });
export const teamThreads = (id: string, mentions = false) =>
  api<TeamMessage[]>(`${base(id)}/threads?mentions=${mentions}`);
export const teamHash = (id: string, channel = "", thread = "", full = false) =>
  `team/${id}${channel ? `/${channel}` : ""}${thread ? `?thread=${encodeURIComponent(thread)}${full ? "&full=1" : ""}` : ""}`;
export const TEAM_EVENT = "research-team-updated";
export const refreshTeam = () => window.dispatchEvent(new Event(TEAM_EVENT));

export const saveTeamWorkflow = (id: string, workflow: Workflow) =>
  send(`${base(id)}/workflow`, workflow, "PUT") as Promise<Workflow>;
export const selectTeamWorkflow = (id: string, workflow_id: string) =>
  send(`${base(id)}/workflow`, { workflow_id }) as Promise<Workflow>;
export const settingsHash = (id: string, target = "members") =>
  teamHash(id, "settings", target);
export const ruleHash = (
  id: string,
  workflow: string,
  version: number,
  rule: string,
) => settingsHash(id, `rule:${workflow}:${version}:${rule}`);
export const readWorkflowSnapshot = (
  id: string,
  workflow: string,
  version: number,
) =>
  api<Workflow>(
    `${base(id)}/workflows/${encodeURIComponent(workflow)}/${version}`,
  );

export const readMemberLibrary = (id: string) =>
  api<LibraryMember[]>(`${base(id)}/library`);
export const saveLibraryMember = (
  id: string,
  member: LibraryMember,
  config: MemberConfig,
  sync: boolean,
  source?: string,
) =>
  send(
    `${base(id)}/library/${member.id}`,
    {
      config,
      version: member.version,
      sync,
      ...(source ? { source } : {}),
      revision: member.revision,
    },
    "PATCH",
  );
export const addTeamMember = (
  id: string,
  body: {
    source?: string;
    config?: MemberConfig;
    library_id?: string;
    copy_from?: string;
    subscriptions?: string[];
  },
) => send(`${base(id)}/members`, body);
export const editTeamMember = (
  id: string,
  member: string,
  body: {
    source?: string;
    config?: MemberConfig;
    enabled?: boolean;
    subscriptions?: string[];
    reset_overrides?: boolean;
    restore_builtin?: boolean;
    revision?: string;
  },
) => send(`${base(id)}/members/${member}`, body, "PATCH");
export const deleteTeamMember = (id: string, member: string) =>
  send(`${base(id)}/members/${member}`, {}, "DELETE");
export interface MemberDetail extends TeamMember {
  activity: string;
  threads: { id: string; channel_id: string; text: string }[];
}
export const readMember = (id: string, member: string) =>
  api<MemberDetail>(`${base(id)}/members/${member}`);

export const convertAgentDocument = (
  id: string,
  source: string,
  config?: MemberConfig,
  channels?: string[],
  role?: string,
) =>
  send(`${base(id)}/agent-document`, {
    source,
    config,
    channels,
    role,
  }) as Promise<AgentDocument>;
export const importAgentDocument = (
  id: string,
  source: string,
  filename: string,
) =>
  send(`${base(id)}/import-agent`, {
    source,
    filename,
  }) as Promise<AgentDocument>;
