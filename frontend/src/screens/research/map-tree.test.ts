import { describe, expect, it } from "vitest";
import type { ResearchNode } from "./research-api";
import { buildTree } from "./map-tree";

const node = (
  id: string,
  parent_id: string | null,
  created_at: string,
): ResearchNode => ({
  id,
  parent_id,
  kind: "question",
  title: id,
  status: "open",
  confidence: 0.5,
  kill_if: "",
  budget_tokens: 0,
  value: "",
  cost: "",
  evidence_for: [],
  evidence_against: [],
  doubts: [],
  spent_tokens: 0,
  spent_job_seconds: 0,
  created_at,
  updated_at: created_at,
});

describe("buildTree", () => {
  it("nests children under their parents, oldest first", () => {
    const tree = buildTree([
      node("b", "root", "2026-10-20T02:00:00"),
      node("root", null, "2026-10-20T00:00:00"),
      node("a", "root", "2026-10-20T01:00:00"),
      node("a1", "a", "2026-10-20T03:00:00"),
    ]);
    expect(tree.map((n) => n.id)).toEqual(["root"]);
    expect(tree[0].children.map((n) => n.id)).toEqual(["a", "b"]);
    expect(tree[0].children[0].children.map((n) => n.id)).toEqual(["a1"]);
  });

  it("hangs a node whose parent is missing under the root", () => {
    const tree = buildTree([
      node("root", null, "2026-10-20T00:00:00"),
      node("orphan", "gone", "2026-10-20T01:00:00"),
    ]);
    expect(tree[0].children.map((n) => n.id)).toEqual(["orphan"]);
  });
});
