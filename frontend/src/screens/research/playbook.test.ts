import { describe, expect, it } from "vitest";
import { sortRules, type PlaybookRule } from "./playbook";

const rule = (
  id: string,
  status: PlaybookRule["status"],
  helpful = 0,
  harmful = 0,
): PlaybookRule => ({
  id,
  when: "w",
  do: "d",
  why: "y",
  sources: ["p"],
  helpful,
  harmful,
  status,
  created_at: "2026-10-20T00:00:00",
});

describe("sortRules", () => {
  it("puts active rules first by net score, then pending, and leaves out retired", () => {
    const sorted = sortRules([
      rule("p1", "pending", 5),
      rule("a1", "active", 1),
      rule("r1", "retired", 9),
      rule("a2", "active", 3, 1),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["a2", "a1", "p1"]);
  });

  it("keeps retired ones when asked", () => {
    expect(
      sortRules([rule("r1", "retired"), rule("a1", "active")], true).map(
        (r) => r.id,
      ),
    ).toEqual(["a1", "r1"]);
  });
});
