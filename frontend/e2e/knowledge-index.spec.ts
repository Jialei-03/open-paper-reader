import { test, expect } from "@playwright/test";
import { buildKnowledge, contentLinks } from "../src/lib/knowledge";
import type { Paper, Item } from "../src/api";

test("Knowledge index ignores code, images, external links and inaccessible targets", () => {
  expect(
    contentLinks(
      "`[code](#paper/a)`\n\n```md\n[code](#paper/b)\n```\n\n![image](#paper/c)\n[external](https://example.com/#paper/d)\n[real](#paper/e)\n[again](#paper/e)\n[reference][ref]\n\n[ref]: #item/f",
    ),
  ).toEqual(["paper/e", "item/f"]);
  const paper = { id: "a", title: "Renamed paper", abstract: "" } as Paper;
  const item = {
    id: "b",
    title: "Note",
    kind: "note",
    paper_id: "a",
    paper_ids: [],
    evidence_ids: [],
    body: "[Old title](#paper/a) [deleted](#paper/missing) [self](#item/b)",
  } as unknown as Item;
  const graph = buildKnowledge([paper], [item]);
  expect(graph.edges).toEqual([
    { source: "item/b", target: "paper/a", label: "所属论文" },
    { source: "item/b", target: "paper/a", label: "正文链接" },
  ]);
  expect(graph.nodes.find((n) => n.id === "paper/a")?.title).toBe(
    "Renamed paper",
  );
  expect(buildKnowledge([], [item]).edges).toEqual([]);
});
