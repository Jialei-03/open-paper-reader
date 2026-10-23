import { api, send } from "../../../api";

export interface Participation {
  id: string;
  name: string;
  messages: number;
  tokens: number;
}
export interface ComparisonThread {
  id: string;
  title: string;
  workflow: string;
  status: string;
  conclusion: string;
  numbers: { name: string; value: number | string }[];
  tokens: number;
  job_seconds: number;
  elapsed_seconds: number;
  rounds: number;
  members: Participation[];
}
export interface Comparison {
  threads: ComparisonThread[];
}
export interface EvaluationBatch {
  id: string;
  workspace_id: string;
  name: string;
  questions: string[];
  workflows: { id: string; name: string }[];
  cells: { question: number; workflow_id: string; research_id: string }[];
  created_at: string;
}
export type EvaluationResults = EvaluationBatch & Comparison;
export const readComparison = (ids: string[]) =>
  api<Comparison>(
    `/research/compare?${new URLSearchParams(ids.map((id) => ["ids", id]))}`,
  );
export const readBatches = (workspaceId: string) =>
  api<EvaluationBatch[]>(`/research/workspaces/${workspaceId}/evaluations`);
export const readBatchResults = (id: string) =>
  api<EvaluationResults>(`/research/evaluations/${id}`);
export const createBatch = (
  workspaceId: string,
  body: {
    name: string;
    questions: string[];
    workflow_ids: string[];
    model_config_id: string;
    defer_start?: boolean;
  },
) =>
  send(
    `/research/workspaces/${workspaceId}/evaluations`,
    body,
  ) as Promise<EvaluationBatch>;

export function differs(values: (number | string | undefined)[]) {
  return new Set(values.filter((value) => value !== undefined)).size > 1;
}
