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
  it.each(["scoping", "discussion"])(
    "presents a real advisor reply from a %s sprint as a conversation message",
    (role) => {
      const reply = "这个结论仅适用于已验证的数据。";
      const turn = { ...sprint("conversation", role), summary: reply };
      // _settle stores the same response in the sprint summary and an advisor
      // message; the actor itself is not a synthetic discussion role.
      const events = [
        ev("message", "human", { text: "解释结论适用范围" }, turn.id),
        ev("research_map_read", "advisor", {}, turn.id),
        ev("message", "advisor", { text: reply }, turn.id),
      ];
      const items = buildThread(events, [turn], [], [], "done");
      const messages = items.filter((item) => item.kind === "message");
      expect(messages.map((item) => [item.who, item.text])).toEqual([
        ["human", "解释结论适用范围"],
        ["discussion", reply],
      ]);
      expect(messages.filter((item) => item.text === reply)).toHaveLength(1);
      expect(events[2].actor).toBe("advisor");
      expect(turn.summary).toBe(reply);
    },
  );

  it("preserves review, system and unbound message speakers", () => {
    const items = buildThread(
      [
        ev("message", "advisor", { text: "实验评审" }, "review"),
        ev("message", "system", { text: "停止回答" }, "chat"),
        ev("message", "advisor", { text: "历史消息" }),
        ev("message", "advisor", { text: "缺少轮次" }, "missing"),
      ],
      [sprint("review", "advisor"), sprint("chat", "discussion")],
      [],
      [],
      "done",
    );
    expect(
      items.filter((item) => item.kind === "message").map((item) => item.who),
    ).toEqual(["advisor", "system", "advisor", "advisor"]);
  });

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

  it("shows the plan on the table as it stands now, not as first written", () => {
    const events = [ev("plan_proposed", "advisor", { plan: plan(1) }, "s1")];
    const moved = { ...plan(1), compute_id: "host" };
    const items = buildThread(
      events,
      [sprint("s1", "scoping")],
      [],
      [],
      "scoping",
      moved,
    );
    const card = items.find((i) => i.kind === "plan");
    expect(card?.kind === "plan" && card.plan.compute_id).toBe("host");
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

  it("lists a sprint's experiments in the order they started", () => {
    const job = (id: string, started_at: string) =>
      ({ id, sprint_id: "s5", started_at }) as ResearchJob;
    // The service sends them newest first.
    const jobs = [
      job("third", "2026-10-20T10:03:00"),
      job("second", "2026-10-20T10:02:00"),
      job("first", "2026-10-20T10:01:00"),
    ];
    const items = buildThread(
      [ev("run_job", "executor", {}, "s5")],
      [sprint("s5", "executor")],
      jobs,
      [],
      "experiments",
    );
    const work = items[0];
    expect(work.kind === "work" && work.jobs.map((j) => j.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("says in order when a dataset is fetched or fails and why it paused", () => {
    const items = buildThread(
      [
        ev("dataset_fetching", "system", { name: "mnist" }),
        ev("dataset_failed", "system", { name: "mnist", reason: "SSL" }),
        ev("paused", "system", { reason: "数据集 mnist 下载失败" }),
        ev("paused", "human", { end_reason: "" }),
      ],
      [],
      [],
      [],
      "experiments",
    );
    const notices = items.filter((i) => i.kind === "notice");
    expect(notices.map((i) => i.kind === "notice" && i.action)).toEqual([
      "dataset_fetching",
      "dataset_failed",
      "paused",
    ]);
    expect(notices.map((i) => i.kind === "notice" && i.failed)).toEqual([
      false,
      true,
      true,
    ]);
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
