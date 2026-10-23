import { api, send } from "../../api";

export interface ScheduleInput {
  title: string;
  prompt: string;
  workspace_id: string;
  destination: "new" | "existing";
  research_id: string | null;
  workflow_id?: string;
  frequency: "daily" | "weekly" | "interval";
  local_time: string;
  weekday: number;
  interval_hours: number;
  timezone: string;
  paused: boolean;
}
export interface Schedule extends ScheduleInput {
  id: string;
  next_run_at: string;
  created_at: string;
  updated_at: string;
}
export interface ScheduleRun {
  id: string;
  trigger: "manual" | "scheduled";
  scheduled_for: string;
  started_at: string;
  finished_at: string;
  status: "running" | "succeeded" | "failed";
  research_id: string | null;
  conversation_url: string | null;
  error: string;
}
export interface ScheduleDetail extends Schedule {
  runs: ScheduleRun[];
}
const base = "/research/schedules";
export const readSchedules = () => api<Schedule[]>(base);
export const readSchedule = (id: string) =>
  api<ScheduleDetail>(`${base}/${id}`);
export const createSchedule = (body: ScheduleInput) =>
  send(base, body) as Promise<Schedule>;
export const updateSchedule = (id: string, body: Partial<ScheduleInput>) =>
  send(`${base}/${id}`, body, "PATCH") as Promise<ScheduleDetail>;
export const deleteSchedule = (id: string) =>
  send(`${base}/${id}`, undefined, "DELETE");
export const runSchedule = (id: string) =>
  send(`${base}/${id}/run`, {}) as Promise<ScheduleRun>;
export const SCHEDULES_CHANGED = "research-schedules-updated";
export const refreshSchedules = () =>
  window.dispatchEvent(new Event(SCHEDULES_CHANGED));
