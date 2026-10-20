import { describe, expect, it } from "vitest";
import type { Frame } from "./frames";
import { poseFor } from "./pose";

const frame = (
  who: Frame["who"],
  action: string | null,
  detail: Record<string, unknown> = {},
): Frame => ({
  key: "k",
  who,
  to: null,
  sprint: 1,
  step: action ? { id: "s", actor: who, action, node: "", detail } : null,
  handoff: action ? "" : "notes",
});

describe("poseFor", () => {
  it("rests everyone who is not acting", () => {
    expect(poseFor("advisor", frame("executor", "run_job"))).toBe("idle");
  });

  it("matches the acting agent's pose to what it does", () => {
    expect(poseFor("executor", frame("executor", "run_job"))).toBe("work");
    expect(poseFor("executor", frame("executor", "focus"))).toBe("talk");
    expect(poseFor("executor", frame("executor", null))).toBe("carry");
    expect(poseFor("advisor", frame("advisor", "drift_judged"))).toBe("work");
    expect(poseFor("advisor", frame("advisor", "concluded"))).toBe("stamp");
    expect(poseFor("distiller", frame("distiller", "distilled"))).toBe("work");
  });

  it("has the gatekeeper raise its sign and the executor flinch when a step is blocked", () => {
    const blocked = frame("system", "drift_blocked");
    expect(poseFor("system", blocked)).toBe("stop");
    expect(poseFor("executor", blocked)).toBe("startled");
  });
});
