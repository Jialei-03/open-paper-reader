import { api, send } from "../../api";

/** A judgment rule learned from finished projects (backend research_playbook.py). */
export interface PlaybookRule {
  id: string;
  when: string;
  do: string;
  why: string;
  sources: string[];
  helpful: number;
  harmful: number;
  status: "pending" | "active" | "retired";
  created_at: string;
}

export interface Playbook {
  version: number;
  rules: PlaybookRule[];
  history: Record<string, unknown>[];
}

const ORDER = { active: 0, pending: 1, retired: 2 } as const;

/** Active rules first (most useful first), then pending; retired ones only when asked. */
export function sortRules(rules: PlaybookRule[], withRetired = false) {
  return rules
    .filter((rule) => withRetired || rule.status !== "retired")
    .sort(
      (a, b) =>
        ORDER[a.status] - ORDER[b.status] ||
        b.helpful - b.harmful - (a.helpful - a.harmful),
    );
}

export const readPlaybook = () => api<Playbook>("/research/playbook");

export const reviewRule = (id: string, approve: boolean) =>
  send(`/research/playbook/rules/${id}`, { approve }) as Promise<PlaybookRule>;
