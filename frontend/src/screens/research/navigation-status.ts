import type { ResearchSummary } from "./research-api";

type ResearchState = Pick<
  ResearchSummary,
  "status" | "stage" | "planned" | "working" | "end_reason"
>;

/** Persistent conversation state does not imply that an agent is executing. */
export function researchStatus(research: ResearchState) {
  if (research.status === "paused") return "research.status.paused";
  if (research.working) return "research.status.running";
  if (research.status === "finished")
    return research.end_reason === "stopped"
      ? "research.status.stopped"
      : "research.status.finished";
  if (
    research.status === "waiting" ||
    (research.stage === "scoping" && research.planned)
  )
    return "research.status.waiting";
  return "research.status.ready";
}
