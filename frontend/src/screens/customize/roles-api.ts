import { api } from "../../api";
import type { MessageKey } from "../../i18n/i18n";

export interface ResearchRole {
  id: string;
  title: string;
}

export const ROLE_NAMES: Record<string, MessageKey> = {
  "research-scoping": "customize.role.scoping",
  "research-executor": "customize.role.executor",
  "research-advisor": "customize.role.advisor",
  "research-distiller": "customize.role.distiller",
  "research-chat": "customize.role.chat",
  "research-lead": "customize.role.lead",
  "research-discussion": "customize.role.discussion",
};

export const listRoles = () => api<ResearchRole[]>("/research/roles");
export const readRole = (id: string) =>
  api<ResearchRole & { body: string }>(
    `/research/roles/${encodeURIComponent(id)}`,
  );
