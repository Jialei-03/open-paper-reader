import { describe, expect, it } from "vitest";
import { layoutState, percentOf, pickJob, type LayoutJob } from "./job";

const job = (change: Partial<LayoutJob>): LayoutJob => ({
  id: "j",
  engine: "pdf",
  status: "completed",
  stage: "",
  completed: 100,
  total: 100,
  error: "",
  source_file: "f1",
  translated_file: "",
  ...change,
});

describe("pickJob", () => {
  it("takes only layout translations of this PDF", () => {
    const jobs = [
      job({ id: "latex", engine: "latex", status: "running" }),
      job({ id: "other", source_file: "f2", status: "running" }),
    ];
    expect(pickJob(jobs, "f1")).toBeNull();
  });

  it("prefers the running one, then the newest completed one, then the newest", () => {
    const failed = job({ id: "failed", status: "failed", error: "x" });
    const done = job({ id: "done", translated_file: "t1" });
    const older = job({ id: "older", translated_file: "t0" });
    const running = job({ id: "running", status: "running" });
    expect(pickJob([failed, done, older], "f1")?.id).toBe("done");
    expect(pickJob([running, failed, done], "f1")?.id).toBe("running");
    expect(pickJob([failed], "f1")?.id).toBe("failed");
  });

  it("does not count a completed job that has no file", () => {
    const empty = job({ id: "empty", translated_file: "" });
    expect(layoutState(pickJob([empty], "f1"))).toBe("idle");
  });
});

describe("layoutState", () => {
  it("says what the paper area shows", () => {
    expect(layoutState(null)).toBe("idle");
    expect(layoutState(job({ status: "queued" }))).toBe("running");
    expect(layoutState(job({ status: "running" }))).toBe("running");
    expect(layoutState(job({ translated_file: "t" }))).toBe("done");
    expect(layoutState(job({ status: "failed" }))).toBe("failed");
    expect(layoutState(job({ status: "cancelled" }))).toBe("idle");
  });
});

describe("percentOf", () => {
  it("is the share done, kept within 0 and 100", () => {
    expect(percentOf(job({ completed: 37, total: 100 }))).toBe(37);
    expect(percentOf(job({ completed: 1, total: 3 }))).toBe(33);
    expect(percentOf(job({ completed: 150, total: 100 }))).toBe(100);
    expect(percentOf(job({ completed: 0, total: 0 }))).toBeNull();
  });
});
