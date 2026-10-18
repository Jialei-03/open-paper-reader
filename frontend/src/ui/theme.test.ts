import { describe, expect, it } from "vitest";
import { parseAppearance, resolveTheme } from "./theme";

describe("resolveTheme", () => {
  it("follows the OS only in system mode", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});
describe("parseAppearance", () => {
  it("keeps valid values and falls back to system", () => {
    expect(parseAppearance("dark")).toBe("dark");
    expect(parseAppearance("light")).toBe("light");
    expect(parseAppearance("sepia")).toBe("system");
    expect(parseAppearance(null)).toBe("system");
  });
});
