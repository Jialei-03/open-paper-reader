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
  avatar?: string;
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
export interface AvatarUpload {
  extension: "png" | "jpg" | "jpeg" | "webp" | "svg";
  content: string;
}
export interface LibraryMember extends AgentFile {
  id: string;
  version: number;
  config: MemberConfig;
  teams: string[];
}
export interface TeamMember extends Partial<MemberConfig>, AgentFile {
  avatar_url?: string | null;
  avatar_seed?: string;
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
  status: "idle" | "working" | "queued" | "waiting";
  active_run_id: string | null;
}
export interface TeamChannel {
  id: string;
  key: string;
  name: string;
  member_id: string | null;
  unread: number;
  last_message?: {
    author_id: string | null;
    author_name: string;
    text: string;
    created_at: string;
  } | null;
  last_at?: string;
  working_member_ids?: string[];
}
export type TeamPaperLink =
  | string
  | {
      title?: string;
      name?: string;
      url?: string;
      href?: string;
    };
export interface TeamChanges {
  commit: string;
  files: { path: string; added: number; removed: number; status: string }[];
  added: number;
  removed: number;
}
export interface TeamFileDiff {
  path: string;
  diff: string;
  truncated: boolean;
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
    to?: string[];
    paper?: TeamPaperLink;
    papers?: TeamPaperLink[];
    citation?: TeamPaperLink;
    citations?: TeamPaperLink[];
    rule?: string;
    workflow?: string;
    workflow_version?: number;
    waiting?: boolean;
    research_id?: string;
    title?: string;
    research_forwarded?: boolean;
    attachments?: { id: string; name: string; url: string }[];
    files?: { path: string; name: string }[];
    commit?: string;
    changes?: TeamChanges;
    reverted_by?: string;
    links?: { channel_id: string; thread_id: string; name: string }[];
    file_error?: string;
    reason?: string;
    limit?: number;
  };
  created_at: string;
  last_message_at?: string;
  replies: number;
  run?: Omit<ResearchRun, "role"> & {
    model_config_id?: string;
    model?: string;
  };
}
export interface Team {
  workspace_id: string;
  members: TeamMember[];
  channels: TeamChannel[];
  notifications: TeamMessage[];
  threads_unread?: number;
  mentions_unread?: number;
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
export const readTeamDiff = (id: string, message: string, path: string) =>
  api<TeamFileDiff>(
    `${base(id)}/messages/${encodeURIComponent(message)}/diff?path=${encodeURIComponent(path)}`,
  );
export const revertTeamMessage = (id: string, message: string) =>
  send(
    `${base(id)}/messages/${encodeURIComponent(message)}/revert`,
    {},
  ) as Promise<TeamMessage>;
export const getTeam = (id: string) => api<Team>(base(id));
export const saveTeamBudget = (id: string, budget: TeamBudget) =>
  send(`${base(id)}/budget`, budget, "PUT");
export const getMessages = (id: string, channel: string, thread?: string) =>
  api<{
    messages: TeamMessage[];
    activity?: TeamMessage[];
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
    avatar_upload?: AvatarUpload;
  },
) => saveMember(`${base(id)}/members`, body, "POST");
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
    avatar_upload?: AvatarUpload;
  },
) => saveMember(`${base(id)}/members/${member}`, body, "PATCH");
const saveMember = (
  path: string,
  body: { avatar_upload?: AvatarUpload },
  method: string,
) =>
  api(path, {
    method,
    body: JSON.stringify(body),
    headers: body.avatar_upload ? { "X-Avatar-Upload": "1" } : undefined,
  });
export const deleteTeamMember = (id: string, member: string) =>
  send(`${base(id)}/members/${member}`, {}, "DELETE");
export interface MemberDetail extends TeamMember {
  activity: string;
  threads: {
    id: string;
    channel_id: string;
    text: string;
    last_message_at: string;
  }[];
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
