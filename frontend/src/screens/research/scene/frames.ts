import type { Step, Turn } from "../conversation";

/** Where each agent sits, and where its work goes. */
export type Place = "bench" | "board" | "desk" | "gate" | "shelf" | "person";
export type Agent = "executor" | "advisor" | "system" | "distiller";

export const HOME: Record<Agent, Place> = {
  executor: "bench",
  advisor: "desk",
  system: "gate",
  distiller: "shelf",
};

/** One beat of the replay: who acts, and where what it did lands (null: at its own place). */
export interface Frame {
  key: string;
  who: Agent;
  to: Place | null;
  sprint: number | null;
  step: Step | null;
  /** The handoff written at the end of a sprint (then `step` is null). */
  handoff: string;
}

const agent = (actor: string): Agent =>
  actor === "advisor" || actor === "system" || actor === "distiller"
    ? actor
    : "executor";

function target(step: Step): Place | null {
  const who = agent(step.actor);
  switch (step.action) {
    case "run_job":
    case "budget_mark":
    case "playbook_version":
    case "finished":
      return null;
    case "end_sprint":
    case "input_needed":
    case "decision_requested":
      return "person";
    case "drift_judged":
    case "drift_blocked":
      return "bench";
    case "advice_skipped":
    case "auto_decided":
      return "desk";
    case "distilled":
      return "shelf";
    default:
      return who === "system" ? null : "board";
  }
}

/** The exchange as a replay, one beat per step, plus a beat for each handoff. */
export function buildFrames(turns: Turn[]): Frame[] {
  const frames: Frame[] = [];
  for (const turn of turns) {
    for (const step of turn.steps) {
      frames.push({
        key: step.id,
        who: agent(step.actor),
        to: target(step),
        sprint: turn.number,
        step,
        handoff: "",
      });
    }
    if (turn.handoff && turn.role !== "system") {
      const who = agent(turn.role);
      frames.push({
        key: `${turn.key}-handoff`,
        who,
        // The executor hands to the advisor; the advisor's word goes back to the bench.
        to: who === "executor" ? "desk" : who === "advisor" ? "bench" : "shelf",
        sprint: turn.number,
        step: null,
        handoff: turn.handoff,
      });
    }
  }
  return frames;
}
