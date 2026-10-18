import { describe, expect, it } from "vitest";
import {
  citedRoute,
  conversation,
  describeStep,
  resendable,
  sameRuns,
  shorten,
  summarize,
  type AgentRun,
  type AgentStep,
} from "./runs";

const PAPER = "0b7f4c2e-6a37-4a52-9d4e-0c6a3c1f2b10";
const FILE = "5d1e9a64-2f0b-4b7e-8a39-4e2d7c9b1a20";

const run = (fields: Partial<AgentRun>): AgentRun => ({
  id: "run",
  prompt: "",
  response: "",
  status: "completed",
  error: "",
  steps: [],
  ...fields,
});

const step = (
  name: string,
  args: Record<string, unknown>,
  summary?: string,
): AgentStep => ({
  name,
  status: "completed",
  arguments: args,
  ...(summary ? { result: { summary } } : {}),
});

describe("summarize", () => {
  it("counts each page read once, the searches, and the rest", () => {
    expect(
      summarize(
        run({
          steps: [
            step("read_file", { page: 3, pages: 2 }),
            step("read_file", { page: 4 }),
            step("read_region", { page: 7, rect: [0, 0, 1, 1] }),
            step("search_file", { query: "memory" }),
            step("list_figures", {}),
          ],
          runtime: { execution_seconds: 9.4 },
        }),
      ),
    ).toEqual({ seconds: 9, pages: 3, searches: 1, others: 1 });
  });

  it("has no time before the run has started, and counts a read without a page as one", () => {
    expect(summarize(run({ steps: [step("read_file", {})] }))).toEqual({
      seconds: null,
      pages: 1,
      searches: 0,
      others: 0,
    });
  });
});

describe("describeStep", () => {
  it("reads the pages and what a search found, as the service writes it", () => {
    expect(describeStep(step("read_file", { page: 2, pages: 3 }))).toEqual({
      kind: "read",
      first: 2,
      last: 4,
    });
    // backend agent_reading.py search_file: `total_matches`, in JSON that may be cut at 2000 characters.
    const summary = JSON.stringify({
      file_id: FILE,
      query: "Zettelkasten",
      total_matches: 4,
      pages_with_matches: [2, 5],
      matches: [{ page: 2, count: 3, snippet: "…" }],
    });
    expect(
      describeStep(step("search_file", { query: "Zettelkasten" }, summary)),
    ).toEqual({ kind: "search", query: "Zettelkasten", found: 4 });
    expect(
      describeStep(
        step(
          "search_file",
          { query: "x" },
          '{"file_id": "f", "query": "x", "total_matches": 12, "pages_with_matches": [1, 2], "matches": [{"page": 1, "snippet": "cut',
        ),
      ),
    ).toEqual({ kind: "search", query: "x", found: 12 });
    // Cut before the count, or a query that only looks like one: no count.
    expect(
      describeStep(
        step("search_file", { query: "x" }, '{"file_id": "f", "query": "x'),
      ),
    ).toEqual({ kind: "search", query: "x", found: null });
    expect(
      describeStep(
        step(
          "search_file",
          { query: '"total_matches": 9' },
          JSON.stringify({ query: '"total_matches": 9' }),
        ),
      ),
    ).toEqual({ kind: "search", query: '"total_matches": 9', found: null });
    expect(
      describeStep(step("search_file", { query: "x" }, '{"total": 4}')),
    ).toEqual({ kind: "search", query: "x", found: null });
    expect(describeStep(step("read_note", { id: "n" }))).toEqual({
      kind: "tool",
      name: "read_note",
    });
  });
});

describe("citedRoute", () => {
  it("reads the old reader's address and the new one's, and nothing else", () => {
    expect(
      citedRoute(
        `#paper/${PAPER}?file=${FILE}&page=3&quote=A%20line&prefix=Before`,
      ),
    ).toEqual({
      paperId: PAPER,
      fileId: FILE,
      page: 3,
      quote: "A line",
      prefix: "Before",
    });
    expect(citedRoute(`#read/${PAPER}?page=2`)).toEqual({
      paperId: PAPER,
      page: 2,
    });
    expect(citedRoute("https://example.org/#paper/x")).toBeNull();
    expect(citedRoute("#library")).toBeNull();
    expect(citedRoute(undefined)).toBeNull();
  });
});

describe("resendable", () => {
  it("keeps what the service takes again and drops what it added", () => {
    expect(
      resendable({
        paper_id: PAPER,
        file_id: FILE,
        version_id: null,
        page: 2,
        source: "page",
        action: "explain",
        category: null,
        quote: "",
        prefix: "",
        rect: null,
        rects: [],
        title: "A paper",
        file_name: "paper.pdf",
        source_url: "#paper/x",
      }),
    ).toEqual({
      paper_id: PAPER,
      file_id: FILE,
      page: 2,
      source: "page",
      action: "explain",
      quote: "",
      prefix: "",
      rects: [],
    });
    expect(resendable(undefined)).toBeUndefined();
  });
});

describe("conversation and shorten", () => {
  it("leaves translations out of the thread", () => {
    const translated = run({
      id: "t",
      runtime: {
        reader_context: {
          paper_id: PAPER,
          file_id: FILE,
          page: 1,
          source: "selection",
          action: "translate",
        },
      },
    });
    expect(
      conversation([run({ id: "a" }), translated]).map((row) => row.id),
    ).toEqual(["a"]);
  });

  it("cuts a long line with an ellipsis, on characters", () => {
    expect(shorten("  Our approach\n draws inspiration  ", 40)).toBe(
      "Our approach draws inspiration",
    );
    expect(shorten("一二三四五六七八", 5)).toBe("一二三四…");
  });
});

describe("sameRuns", () => {
  const listed = () => [
    run({ id: "a", prompt: "Q1", response: "Done." }),
    run({
      id: "b",
      prompt: "Q2",
      status: "running",
      response: "Half",
      steps: [step("read_file", { page: 1 })],
      runtime: { phase: "tool", execution_seconds: 2.2 },
    }),
  ];

  it("is the same when a list read again brings nothing new", () => {
    expect(sameRuns(listed(), listed())).toBe(true);
  });

  it("is news when anything the thread shows has changed", () => {
    const changes: ((runs: AgentRun[]) => void)[] = [
      (runs) => runs.pop(),
      (runs) => (runs[1].status = "completed"),
      (runs) => (runs[1].response = "Halt"),
      (runs) => (runs[1].response += " more"),
      (runs) => (runs[1].error = "Failed"),
      (runs) => runs[1].steps.push(step("search_file", { query: "q" })),
      (runs) => (runs[1].steps[0] = { ...runs[1].steps[0], status: "failed" }),
      (runs) => (runs[1].runtime = { phase: "tool", execution_seconds: 3.1 }),
      (runs) => (runs[0].id = "c"),
    ];
    for (const change of changes) {
      const next = listed();
      change(next);
      expect(sameRuns(listed(), next)).toBe(false);
    }
  });
});
