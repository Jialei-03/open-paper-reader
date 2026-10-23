import { expect, it } from "vitest";
import { threadTree } from "./thread-tree";
import type { NavigationResearch } from "./navigation-api";

it("keeps children under their parents and includes old orphan and cyclic data once", () => {
  const row = (id: string, parent_id: string | null, updated_at: string) =>
    ({ id, parent_id, updated_at }) as NavigationResearch;
  const rows = [
    row("child", "parent", "3"),
    row("parent", null, "1"),
    row("orphan", "missing", "2"),
    row("cycle", "cycle", "0"),
  ];
  expect(
    threadTree(rows).map(({ research, depth }) => [research.id, depth]),
  ).toEqual([
    ["orphan", 0],
    ["parent", 0],
    ["child", 1],
    ["cycle", 0],
  ]);
});
