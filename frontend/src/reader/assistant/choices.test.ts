import { describe, expect, it } from "vitest";
import { effortChoices, optionsFor, validChoice } from "./choices";

const full = {
  thinking_modes: ["default", "disabled", "adaptive"],
  effort_levels: ["default", "low", "medium", "high", "xhigh", "max"],
};

describe("effortChoices", () => {
  it("offers the default, off and every level a model supports", () => {
    expect(effortChoices(full).map((c) => c.id)).toEqual([
      "default",
      "off",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });
  it("leaves out off and levels the model cannot do", () => {
    const fixed = { thinking_modes: ["default"], effort_levels: ["default"] };
    expect(effortChoices(fixed).map((c) => c.id)).toEqual(["default"]);
    expect(effortChoices(undefined).map((c) => c.id)).toEqual(["default"]);
  });
});

describe("optionsFor", () => {
  it("sends nothing for the default", () => {
    expect(optionsFor(full, "default")).toBeUndefined();
    expect(optionsFor(full, "")).toBeUndefined();
  });
  it("maps off and levels to the run's options", () => {
    expect(optionsFor(full, "off")).toEqual({
      thinking_mode: "disabled",
      reasoning_effort: "default",
    });
    expect(optionsFor(full, "high")).toEqual({
      thinking_mode: "default",
      reasoning_effort: "high",
    });
  });
  it("ignores a level the model does not have", () => {
    expect(optionsFor({ thinking_modes: ["default"] }, "high")).toBeUndefined();
  });
});

describe("validChoice", () => {
  it("falls back to the default when the model lost the level", () => {
    expect(validChoice(full, "max")).toBe("max");
    expect(validChoice({ effort_levels: ["default"] }, "max")).toBe("default");
  });
});
