import { describe, expect, it } from "vitest";
import type { Turn } from "../conversation";
import { buildFrames } from "./frames";

const step = (
  actor: string,
  action: string,
  detail: Record<string, unknown> = {},
) => ({
  id: `${actor}-${action}`,
  actor,
  action,
  node: "N",
  detail,
});
const turn = (
  role: string,
  steps: ReturnType<typeof step>[],
  handoff = "",
): Turn => ({
  key: `${role}-${steps.length}`,
  role,
  number: role === "system" ? null : 1,
  steps,
  handoff,
  nextFocus: "",
});

describe("buildFrames", () => {
  it("sends the executor's work to the board and its handoff to the advisor", () => {
    const frames = buildFrames([
      turn(
        "executor",
        [step("executor", "focus"), step("executor", "run_job")],
        "done",
      ),
    ]);
    expect(frames.map((f) => [f.who, f.to])).toEqual([
      ["executor", "board"],
      ["executor", null],
      ["executor", "desk"],
    ]);
    expect(frames[2].handoff).toBe("done");
  });

  it("sends the advisor's verdicts to the board, its drift calls and handoff to the executor", () => {
    const frames = buildFrames([
      turn(
        "advisor",
        [
          step("advisor", "advice"),
          step("advisor", "drift_judged"),
          step("advisor", "concluded"),
        ],
        "assessment",
      ),
    ]);
    expect(frames.map((f) => f.to)).toEqual([
      "board",
      "bench",
      "board",
      "bench",
    ]);
  });

  it("lets the system stop the executor at the gate, and a need go to the person", () => {
    const frames = buildFrames([
      turn("executor", [
        step("system", "drift_blocked"),
        step("executor", "end_sprint", { needs_input: "followup.csv" }),
      ]),
    ]);
    expect(frames.map((f) => [f.who, f.to])).toEqual([
      ["system", "bench"],
      ["executor", "person"],
    ]);
  });
});
