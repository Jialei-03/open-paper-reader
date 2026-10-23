import { describe, expect, it } from "vitest";
import { researchStatus } from "./navigation-status";

const idle = {
  status: "active" as const,
  stage: "scoping" as const,
  planned: false,
  working: "",
  end_reason: "",
};

describe("research navigation status", () => {
  it("calls an idle discussion ready to chat", () => {
    expect(researchStatus(idle)).toBe("research.status.ready");
  });
  it("marks actual execution as working, including follow-ups after completion", () => {
    expect(researchStatus({ ...idle, working: "advisor" })).toBe(
      "research.status.running",
    );
    expect(
      researchStatus({ ...idle, status: "finished", working: "advisor" }),
    ).toBe("research.status.running");
  });
  it("gives a paused state priority over a leftover working role", () => {
    expect(
      researchStatus({ ...idle, status: "paused", working: "executor" }),
    ).toBe("research.status.paused");
  });
  it("marks a scoping plan as needing confirmation", () => {
    expect(researchStatus({ ...idle, planned: true })).toBe(
      "research.status.waiting",
    );
  });
  it("marks an explicit waiting state as needing input", () => {
    expect(researchStatus({ ...idle, status: "waiting" })).toBe(
      "research.status.waiting",
    );
  });
  it("distinguishes user stops from completed research", () => {
    expect(
      researchStatus({ ...idle, status: "finished", end_reason: "stopped" }),
    ).toBe("research.status.stopped");
    expect(
      researchStatus({ ...idle, status: "finished", end_reason: "concluded" }),
    ).toBe("research.status.finished");
  });
});
