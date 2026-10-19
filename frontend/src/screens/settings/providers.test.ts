import { describe, expect, it } from "vitest";
import type { ModelRow } from "../setup/model-api";
import { groupByHost, isOwned, searchModels } from "./providers";

const row = (id: string, base_url: string, model: string, shared = false) =>
  ({
    id,
    name: model,
    model,
    protocol: "openai",
    base_url,
    shared,
  }) as ModelRow;

describe("searchModels", () => {
  const names = ["gpt-4.1", "gpt-4.1-mini", "o3", "text-embedding-3-small"];
  it("returns everything for an empty query", () => {
    expect(searchModels(names, "  ")).toEqual(names);
  });
  it("matches words in any order and any case", () => {
    expect(searchModels(names, "MINI gpt")).toEqual(["gpt-4.1-mini"]);
    expect(searchModels(names, "zzz")).toEqual([]);
  });
});

describe("groupByHost", () => {
  it("groups by service and puts the platform's own models apart", () => {
    const groups = groupByHost([
      row("1", "https://api.deepseek.com/v1", "a"),
      row("2", "https://api.openai.com/v1", "b"),
      row("3", "https://api.deepseek.com/v1", "c"),
      row("4", "https://shared.example/v1", "d", true),
    ]);
    expect(groups.map((g) => [g.host, g.rows.map((r) => r.id)])).toEqual([
      ["api.deepseek.com", ["1", "3"]],
      ["api.openai.com", ["2"]],
      ["", ["4"]],
    ]);
  });
});

describe("isOwned", () => {
  const rows = [row("1", "https://api.openai.com/v1/", "gpt-4.1")];
  it("ignores a trailing slash", () => {
    expect(isOwned(rows, "https://api.openai.com/v1", "gpt-4.1")).toBe(true);
    expect(isOwned(rows, "https://api.openai.com/v1", "o3")).toBe(false);
  });
});
