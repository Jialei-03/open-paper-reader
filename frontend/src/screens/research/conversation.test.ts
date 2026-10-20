import { describe, expect, it } from "vitest";
import { buildConversation } from "./conversation";
import type {
  ResearchEvent,
  ResearchNode,
  ResearchSprint,
} from "./research-api";

const node = (id: string, title: string) => ({ id, title }) as ResearchNode;
const sprint = (
  id: string,
  number: number,
  role: ResearchSprint["role"],
  summary = "",
) =>
  ({
    id,
    number,
    role,
    summary,
    next_focus: "",
    status: "ended",
  }) as ResearchSprint;
let n = 0;
const ev = (
  actor: ResearchEvent["actor"],
  action: string,
  sprint_id: string | null,
  detail: Record<string, unknown> = {},
  node_id: string | null = null,
): ResearchEvent => ({
  id: `e${++n}`,
  actor,
  action,
  sprint_id,
  node_id,
  detail,
  created_at: `2026-10-20T00:00:${String(n).padStart(2, "0")}Z`,
});

describe("buildConversation", () => {
  it("puts each sprint's steps in one turn, in order, naming the node they touch", () => {
    const turns = buildConversation(
      [
        ev("system", "sprint_planned", null, { number: 1 }),
        ev("executor", "focus", "s1", { intent: "check columns" }, "h1"),
        ev(
          "executor",
          "record_result",
          "s1",
          { summary: "0.96 vs 0.72" },
          "h1",
        ),
        ev(
          "advisor",
          "advice",
          "s2",
          { verdict: "kill", reason: "leak" },
          "h1",
        ),
      ],
      [
        sprint("s1", 1, "executor", "found the leak"),
        sprint("s2", 2, "advisor", "answered"),
      ],
      [node("h1", "Uses a field set after the label")],
    );
    expect(turns.map((t) => t.role)).toEqual(["executor", "advisor"]);
    expect(turns[0].steps.map((s) => s.action)).toEqual([
      "focus",
      "record_result",
    ]);
    expect(turns[0].steps[0].node).toBe("Uses a field set after the label");
    expect(turns[0].handoff).toBe("found the leak");
    expect(turns[1].steps[0].detail.verdict).toBe("kill");
  });

  it("gives system notes outside a sprint their own turn and hides bookkeeping", () => {
    const turns = buildConversation(
      [
        ev("system", "playbook_version", null, {
          version: 10,
          active: ["a", "b"],
        }),
        ev("system", "sprint_planned", null, { number: 1 }),
        ev("executor", "focus", "s1", { intent: "x" }),
        ev("system", "drift_blocked", "s1", {
          tool: "add_node",
          reason: "no_focus",
        }),
        ev("system", "budget_mark", null, { mark: 0.5 }),
      ],
      [sprint("s1", 1, "executor")],
      [],
    );
    expect(turns.map((t) => t.role)).toEqual(["system", "executor", "system"]);
    // A block by the system during a sprint is part of that sprint's exchange.
    expect(turns[1].steps.map((s) => s.actor)).toEqual(["executor", "system"]);
  });

  it("uses the title an added node was given when the node is not on the map", () => {
    const turns = buildConversation(
      [
        ev(
          "executor",
          "add_node",
          "s1",
          { kind: "hypothesis", title: "H" },
          "gone",
        ),
      ],
      [sprint("s1", 1, "executor")],
      [],
    );
    expect(turns[0].steps[0].node).toBe("H");
  });
});
