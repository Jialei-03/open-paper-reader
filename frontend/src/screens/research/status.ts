import type { MessageKey } from "../../i18n/i18n";
import type { ResearchSummary } from "./research-api";

/**
 * What a research's badge says, and the tone it takes: a conversation without
 * a plan, a plan being talked through, a stage of the work, or how it ended.
 */
export function statusOf(r: ResearchSummary): {
  key: MessageKey;
  tone: string;
} {
  if (r.stage === "scoping" && r.planned === false)
    return { key: "projects.kind.chat", tone: "chat" };
  if (r.column === "review")
    return { key: "projects.column.review", tone: "review" };
  if (r.stage === "scoping")
    return { key: "projects.status.scoping", tone: "running" };
  if (r.column === "running" || r.column === "todo")
    return { key: `research.stage.${r.stage}` as MessageKey, tone: r.column };
  return { key: `projects.column.${r.column}` as MessageKey, tone: r.column };
}
