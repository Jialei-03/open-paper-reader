import { describe, expect, it } from "vitest";
import {
  defaultEngine,
  isArxivVersion,
  lacksSource,
  layoutState,
  percentOf,
  keptJob,
  pickJob,
  type LayoutJob,
  type LayoutState,
} from "./job";

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

describe("LaTeX translations", () => {
  it("count for the paper's current version, whatever PDF they started from", () => {
    const latex = job({
      id: "latex",
      engine: "latex",
      version_id: "v1",
      source_file: "",
      translated_file: "t",
    });
    expect(pickJob([latex], "f1", "v1")?.id).toBe("latex");
    expect(pickJob([latex], "f1", "v2")).toBeNull();
    // A layout translation started after it, still running, is the one that matters.
    const pdf = job({ id: "pdf", status: "running" });
    expect(pickJob([pdf, latex], "f1", "v1")?.id).toBe("pdf");
  });

  it("knows a version without LaTeX source from other failures", () => {
    const failed = (fields: Partial<LayoutJob>) =>
      job({ engine: "latex", status: "failed", error: "x", ...fields });
    expect(lacksSource(failed({ no_source: true }))).toBe(true);
    expect(lacksSource(failed({ no_source: false }))).toBe(false);
    expect(lacksSource(failed({}))).toBe(false);
    expect(lacksSource(failed({ engine: "pdf", no_source: true }))).toBe(false);
    expect(lacksSource(failed({ status: "running", no_source: true }))).toBe(
      false,
    );
  });

  it("are offered for arXiv papers of a fixed version", () => {
    expect(isArxivVersion("arxiv:2504.19413v1")).toBe(true);
    expect(isArxivVersion("arxiv:2504.19413")).toBe(false);
    expect(isArxivVersion("doi:10.1000/x")).toBe(false);
    expect(isArxivVersion("")).toBe(false);
  });
});

describe("pickJob by method", () => {
  it("keeps each method's result apart", () => {
    const jobs = [
      job({ id: "pdf-failed", status: "failed", error: "x" }),
      job({
        id: "latex-done",
        engine: "latex",
        version_id: "v1",
        translated_file: "t1",
      }),
    ];
    expect(pickJob(jobs, "f1", "v1", "latex")?.id).toBe("latex-done");
    expect(pickJob(jobs, "f1", "v1", "pdf")?.id).toBe("pdf-failed");
  });
});

describe("defaultEngine", () => {
  const states = (latex: LayoutState, pdf: LayoutState) => ({ latex, pdf });
  it("follows the person's choice where it can be made", () => {
    expect(defaultEngine(states("done", "done"), true, "pdf")).toBe("pdf");
    expect(defaultEngine(states("idle", "done"), false, "latex")).toBe("pdf");
  });
  it("shows the completed one, else the running one, else LaTeX for arXiv", () => {
    expect(defaultEngine(states("idle", "done"), true, null)).toBe("pdf");
    expect(defaultEngine(states("done", "done"), true, null)).toBe("latex");
    expect(defaultEngine(states("idle", "running"), true, null)).toBe("pdf");
    expect(defaultEngine(states("idle", "idle"), true, null)).toBe("latex");
    expect(defaultEngine(states("idle", "idle"), false, null)).toBe("pdf");
  });
});

describe("keptJob", () => {
  it("keeps the newest completed translation while a newer one runs or fails", () => {
    const running = job({ id: "running", status: "running" });
    const done = job({ id: "done", translated_file: "t1" });
    expect(keptJob([running, done], "f1")?.id).toBe("done");
    expect(pickJob([running, done], "f1")?.id).toBe("running");
    expect(keptJob([running], "f1")).toBeNull();
  });
});
