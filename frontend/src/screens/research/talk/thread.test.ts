import { describe, expect, it } from "vitest";
import type {
  ResearchEvent,
  ResearchJob,
  ResearchSprint,
} from "../research-api";
import { buildThread } from "./thread";

let clock = 0;
const ev = (
  action: string,
  actor: string,
  detail: Record<string, unknown> = {},
  sprint_id: string | null = null,
): ResearchEvent => ({
  id: `e${++clock}`,
  node_id: null,
  sprint_id,
  actor,
  action,
  detail,
  created_at: `2026-10-20T10:00:${String(clock).padStart(2, "0")}`,
});
const sprint = (id: string, role: string, status = "ended"): ResearchSprint =>
  ({
    id,
    number: 1,
    role,
    run_id: "r",
    status,
    focus_node_id: null,
    summary: "",
    next_focus: "",
    waiting_on: [],
    tokens: 0,
    created_at: "2026-10-20T10:00:00",
    updated_at: "",
  }) as ResearchSprint;
const plan = (version: number) => ({
  version,
  question: "q",
  goal: "",
  metric: "acc",
  baseline: "",
  hypotheses: [{ title: "h", kill_if: "k", value: "", cost: "" }],
  datasets: ["mnist"],
  compute_id: "local",
  budget: { max_sprints: 10, max_job_hours: 2 },
  summary: "",
  approved_at: null,
});

describe("buildThread", () => {
  it("shows scoping as a round and only the newest plan is on the table", () => {
    const events = [
      ev("message", "human", { text: "想提升 MNIST" }),
      ev("research_map_read", "advisor", {}, "s1"),
      ev("plan_proposed", "advisor", { plan: plan(1) }, "s1"),
      ev("message", "advisor", { text: "这样安排行吗？" }, "s1"),
      ev("plan_proposed", "advisor", { plan: plan(2) }, "s2"),
    ];
    const items = buildThread(
      events,
      [sprint("s1", "scoping"), sprint("s2", "scoping")],
      [],
      [],
      "scoping",
    );
    expect(items.map((i) => i.kind)).toEqual([
      "message",
      "work",
      "plan",
      "message",
      "plan",
    ]);
    const plans = items.filter((i) => i.kind === "plan");
    expect(plans.map((p) => p.kind === "plan" && p.current)).toEqual([
      false,
      true,
    ]);
  });

  it("folds a sprint's steps and jobs into one block, and marks answered decisions", () => {
    const job = { id: "j1", sprint_id: "s3" } as ResearchJob;
    const ask = ev("decision_requested", "advisor", { kind: "conclusion" });
    const events = [
      ev("stage_changed", "human", { to: "experiments", note: "开始吧" }),
      ev("focus", "executor", { intent: "x" }, "s3"),
      ev("run_job", "executor", { job_id: "j1" }, "s3"),
      ask,
      ev("human_decision", "human", { request_id: ask.id, approve: true }),
    ];
    const items = buildThread(
      events,
      [sprint("s3", "executor")],
      [job],
      [],
      "conclusion",
    );
    expect(items.map((i) => i.kind)).toEqual(["stage", "work", "decision"]);
    const work = items[1];
    expect(work.kind === "work" && work.steps.length).toBe(2);
    expect(work.kind === "work" && work.jobs).toEqual([job]);
    expect(items[2].kind === "decision" && items[2].open).toBe(false);
  });

  it("shows a running sprint before its first step", () => {
    const items = buildThread(
      [],
      [sprint("s4", "executor", "running")],
      [],
      [],
      "experiments",
    );
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("work");
  });
});
