import { describe, expect, it } from "vitest";
import {
  current,
  output,
  segment,
  summary,
  target,
  type RunStep,
} from "./model";

const step = (
  name: string,
  status = "completed",
  extra: Partial<RunStep> = {},
): RunStep => ({
  name,
  status,
  ...extra,
});

describe("a run, read as a turn", () => {
  it("keeps words and tools in order and merges finished runs of one tool", () => {
    const segments = segment([
      step("bash", "completed", { said: "先看显卡" }),
      step("bash"),
      step("bash"),
      step("read"),
      step("bash", "failed"),
      step("bash", "running", { said: "再试一次" }),
    ]);
    expect(segments.map((s) => s.kind)).toEqual([
      "said",
      "steps",
      "said",
      "steps",
    ]);
    const rows = segments[1].kind === "steps" ? segments[1].rows : [];
    expect(rows.map((r) => [r.name, r.steps.length])).toEqual([
      ["bash", 3],
      ["read", 1],
      ["bash", 1],
    ]);
  });

  it("sums the work up by kind, in a fixed order", () => {
    expect(
      summary([
        step("read"),
        step("bash"),
        step("run_job"),
        step("bash"),
        step("edit"),
      ]),
    ).toEqual([
      ["command", 2],
      ["experiment", 1],
      ["read", 1],
      ["write", 1],
    ]);
  });

  it("names what a step was about, and what came back", () => {
    expect(
      target(
        step("bash", "completed", {
          arguments: '{"command":"nvidia-smi\\nls"}',
        }),
      ),
    ).toBe("nvidia-smi");
    const printed = JSON.stringify({
      content: [{ type: "text", text: "RTX 5060 Ti" }],
    });
    expect(
      output(step("bash", "completed", { result: { summary: printed } })),
    ).toBe("RTX 5060 Ti");
    expect(output(step("bash", "failed", { error: "超时" }))).toBe("超时");
  });

  it("finds the step in progress", () => {
    expect(
      current([
        step("read"),
        step("bash", "running", { arguments: { command: "x" } }),
      ])?.name,
    ).toBe("bash");
    expect(current([step("read")])).toBeNull();
  });
});
