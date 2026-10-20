import type { Agent, Frame } from "./frames";

/** What a figure is doing in a beat; each has its own pixels (sprites.ts). */
export type Pose =
  | "idle"
  | "work"
  | "talk"
  | "carry"
  | "stop"
  | "startled"
  | "stamp";

/** The pose of `agent` while `frame` plays: the actor acts it out, the rest wait. */
export function poseFor(agent: Agent, frame: Frame): Pose {
  const action = frame.step?.action ?? "";
  if (action === "drift_blocked") {
    if (agent === "system") return "stop";
    if (agent === "executor") return "startled";
  }
  if (frame.who !== agent) return "idle";
  if (!frame.step) return "carry";
  switch (action) {
    case "run_job":
    case "record_result":
    case "update_node":
    case "drift_judged":
    case "distilled":
      return "work";
    case "concluded":
    case "advice":
      return action === "concluded" ? "stamp" : "talk";
    default:
      return "talk";
  }
}
