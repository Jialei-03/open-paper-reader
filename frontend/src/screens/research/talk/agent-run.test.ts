import { describe, expect, it } from "vitest";
import { detailOf, outputOf } from "./AgentRunView";

describe("a run step, as the window shows it", () => {
  it("names the command or path it was about", () => {
    expect(
      detailOf({
        name: "bash",
        status: "completed",
        arguments: JSON.stringify({ command: "nvidia-smi\necho done" }),
      }),
    ).toBe("nvidia-smi");
    expect(
      detailOf({
        name: "write",
        status: "running",
        arguments: { path: "train.py" },
      }),
    ).toBe("train.py");
  });

  it("shows what a tool printed, or why it failed", () => {
    const printed = JSON.stringify({
      content: [{ type: "text", text: "RTX 5060 Ti\n16 GB" }],
    });
    expect(
      outputOf({
        name: "bash",
        status: "completed",
        result: { summary: printed },
      }),
    ).toBe("RTX 5060 Ti\n16 GB");
    expect(
      outputOf({
        name: "bash",
        status: "failed",
        error: "连不上 research-wsl",
      }),
    ).toBe("连不上 research-wsl");
    expect(
      outputOf({
        name: "focus",
        status: "completed",
        result: { summary: "ok" },
      }),
    ).toBe("ok");
  });
});
