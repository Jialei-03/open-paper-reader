import { describe, expect, it } from "vitest";
import {
  focusTreeGroup,
  readTreePreferences,
  visibleTreeRows,
  writeTreePreferences,
  type ResearchTreePreferences,
} from "./navigation-preferences";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe("research sidebar preferences", () => {
  it("keeps grouping, manual folds and expanded lists separate for each owner", () => {
    const storage = memoryStorage();
    const preferences: ResearchTreePreferences = {
      mode: "collection",
      workspace: { open: ["local"], expanded: ["local"] },
      collection: { open: [], expanded: ["writing"] },
    };
    writeTreePreferences("alice", preferences, storage);
    expect(readTreePreferences("alice", storage)).toEqual(preferences);
    expect(readTreePreferences("bob", storage)).toEqual({ mode: "workspace" });
  });

  it("starts with one relevant folder instead of expanding every workspace", () => {
    const fresh = focusTreeGroup(
      { mode: "workspace" },
      "workspace",
      "wsl",
      "local",
      false,
    );
    expect(fresh.workspace).toEqual({ open: ["wsl"], expanded: [] });
    expect(
      focusTreeGroup(
        { mode: "workspace" },
        "workspace",
        undefined,
        "local",
        false,
      ).workspace,
    ).toEqual({ open: ["local"], expanded: [] });
  });

  it("preserves a saved manual fold on reload and during background refresh", () => {
    const folded: ResearchTreePreferences = {
      mode: "workspace",
      workspace: { open: [], expanded: ["wsl"] },
    };
    expect(focusTreeGroup(folded, "workspace", "wsl", "local", false)).toBe(
      folded,
    );
  });

  it("opens the new selection's folder once and retains other manual choices", () => {
    const previous: ResearchTreePreferences = {
      mode: "workspace",
      workspace: { open: ["local"], expanded: [] },
      collection: { open: [], expanded: ["writing"] },
    };
    const selected = focusTreeGroup(
      previous,
      "workspace",
      "wsl",
      "local",
      true,
    );
    expect(selected.workspace).toEqual({
      open: ["local", "wsl"],
      expanded: [],
    });
    expect(selected.collection).toBe(previous.collection);
    expect(focusTreeGroup(selected, "workspace", "wsl", "local", true)).toBe(
      selected,
    );
  });

  it("ignores malformed preferences and unavailable storage", () => {
    expect(readTreePreferences("alice", { getItem: () => "{" })).toEqual({
      mode: "workspace",
    });
    expect(
      readTreePreferences("alice", {
        getItem: () =>
          JSON.stringify({
            mode: "collection",
            workspace: { open: "oops", expanded: [] },
          }),
      }),
    ).toEqual({
      mode: "collection",
      workspace: undefined,
      collection: undefined,
    });
    expect(
      readTreePreferences("alice", {
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toEqual({ mode: "workspace" });
    expect(() =>
      writeTreePreferences(
        "alice",
        { mode: "workspace" },
        {
          setItem: () => {
            throw new Error("full");
          },
        },
      ),
    ).not.toThrow();
  });

  it("does not persist anonymous preferences across signed-in owners", () => {
    const storage = memoryStorage();
    writeTreePreferences("", { mode: "collection" }, storage);
    expect(readTreePreferences("", storage)).toEqual({ mode: "workspace" });
  });
});

describe("short research lists", () => {
  const rows = Array.from({ length: 9 }, (_, index) => ({
    id: String(index),
    pinned: index < 3,
  }));
  it("keeps an older current research visible while preserving the pin order", () => {
    const visible = visibleTreeRows(rows, "8", false);
    expect(visible.map((row) => row.id)).toEqual(["0", "1", "2", "3", "8"]);
    expect(visible.filter((row) => row.pinned)).toEqual(rows.slice(0, 3));
  });
  it("shows the first five when the current research is already visible or elsewhere", () => {
    expect(visibleTreeRows(rows, "3", false)).toEqual(rows.slice(0, 5));
    expect(visibleTreeRows(rows, "unknown", false)).toEqual(rows.slice(0, 5));
  });
  it("shows every research when expanded and leaves short lists unchanged", () => {
    expect(visibleTreeRows(rows, "8", true)).toBe(rows);
    const short = rows.slice(0, 2);
    expect(visibleTreeRows(short, "8", false)).toBe(short);
  });
});
