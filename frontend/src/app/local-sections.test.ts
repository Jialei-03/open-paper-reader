import { describe, expect, it } from "vitest";
import { localSection, validSectionAddress } from "./local-sections";
import { parseAppRoute } from "./routes";

describe("local app sections", () => {
  it("keeps reading and discovery within materials and research tasks within tasks", () => {
    for (const hash of [
      "library?view=reading",
      "discover",
      "home",
      "read/p1?page=2",
    ])
      expect(localSection(parseAppRoute(hash))).toBe("materials");
    expect(localSection(parseAppRoute("tasks/waiting"))).toBe("tasks");
    expect(localSection(parseAppRoute("customize/models"))).toBe("customize");
    expect(localSection(parseAppRoute("board"))).toBe("board");
    expect(localSection(parseAppRoute("new"))).toBe("research");
  });
  it("does not remember action URLs, settings overlays or redirects as section destinations", () => {
    expect(
      validSectionAddress("materials", "library?view=reading&q=memory"),
    ).toBe(true);
    expect(validSectionAddress("materials", "library?import=1")).toBe(false);
    expect(validSectionAddress("materials", "home")).toBe(false);
    expect(
      validSectionAddress("materials", "open?url=https://arxiv.org/abs/1"),
    ).toBe(false);
    expect(validSectionAddress("research", "settings/models")).toBe(false);
    expect(validSectionAddress("research", "nonsense")).toBe(false);
    expect(validSectionAddress("tasks", "new")).toBe(false);
    expect(validSectionAddress("tasks", { filter: "active" })).toBe(false);
  });
});
