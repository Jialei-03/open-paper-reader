import { describe, expect, it } from "vitest";
import { formatShortcut, isMacPlatform, matchesShortcut } from "./shortcut";

type Mods = Partial<
  Record<"metaKey" | "ctrlKey" | "shiftKey" | "altKey", boolean>
>;
const ev = (key: string, mods: Mods = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("isMacPlatform", () => {
  it("is true for Apple platforms only", () => {
    expect(isMacPlatform("MacIntel")).toBe(true);
    expect(isMacPlatform("iPhone")).toBe(true);
    expect(isMacPlatform("iPad")).toBe(true);
    expect(isMacPlatform("Win32")).toBe(false);
    expect(isMacPlatform("Linux x86_64")).toBe(false);
    expect(isMacPlatform("")).toBe(false);
  });
});

describe("formatShortcut", () => {
  it("formats per platform", () => {
    expect(formatShortcut("mod+k", true)).toBe("⌘K");
    expect(formatShortcut("mod+k", false)).toBe("Ctrl+K");
    expect(formatShortcut("shift+enter", true)).toBe("⇧↵");
    expect(formatShortcut("shift+enter", false)).toBe("Shift+Enter");
    expect(formatShortcut("alt+e", true)).toBe("⌥E");
    expect(formatShortcut("alt+e", false)).toBe("Alt+E");
    expect(formatShortcut("e", false)).toBe("E");
    expect(formatShortcut("e", true)).toBe("E");
    expect(formatShortcut("enter", false)).toBe("↵");
    expect(formatShortcut("enter", true)).toBe("↵");
    expect(formatShortcut("escape", false)).toBe("Esc");
    expect(formatShortcut("escape", true)).toBe("Esc");
    expect(formatShortcut("1", false)).toBe("1");
  });
  it("shows any single printable character as it is", () => {
    expect(formatShortcut("mod+\\", true)).toBe("⌘\\");
    expect(formatShortcut("mod+\\", false)).toBe("Ctrl+\\");
    expect(formatShortcut("/", false)).toBe("/");
    expect(formatShortcut("mod+.", true)).toBe("⌘.");
  });
  it("keeps a plus sign usable as the key", () => {
    expect(formatShortcut("mod++", true)).toBe("⌘+");
    expect(formatShortcut("mod++", false)).toBe("Ctrl++");
    expect(formatShortcut("+", false)).toBe("+");
  });
  it("lists several modifiers in the platform's order, however they are written", () => {
    expect(formatShortcut("mod+shift+k", true)).toBe("⇧⌘K");
    expect(formatShortcut("shift+mod+k", true)).toBe("⇧⌘K");
    expect(formatShortcut("alt+mod+shift+k", true)).toBe("⌥⇧⌘K");
    expect(formatShortcut("shift+mod+k", false)).toBe("Ctrl+Shift+K");
    expect(formatShortcut("shift+alt+mod+k", false)).toBe("Ctrl+Alt+Shift+K");
  });
  it("accepts an upper-case spec", () => {
    expect(formatShortcut("Mod+K", false)).toBe("Ctrl+K");
  });
});

describe("matchesShortcut", () => {
  it("matches modifiers exactly", () => {
    expect(matchesShortcut(ev("k", { metaKey: true }), "mod+k", true)).toBe(
      true,
    );
    expect(matchesShortcut(ev("K", { ctrlKey: true }), "mod+k", false)).toBe(
      true,
    );
    expect(matchesShortcut(ev("k", { ctrlKey: true }), "mod+k", true)).toBe(
      false,
    );
    expect(matchesShortcut(ev("k", { metaKey: true }), "mod+k", false)).toBe(
      false,
    );
    expect(matchesShortcut(ev("e", { shiftKey: true }), "e", false)).toBe(
      false,
    );
    expect(matchesShortcut(ev("Enter"), "enter", false)).toBe(true);
  });
  it("does not match when a modifier is missing or extra", () => {
    expect(matchesShortcut(ev("k"), "mod+k", false)).toBe(false);
    expect(
      matchesShortcut(ev("k", { ctrlKey: true, altKey: true }), "mod+k", false),
    ).toBe(false);
    expect(
      matchesShortcut(ev("Enter", { shiftKey: true }), "shift+enter", false),
    ).toBe(true);
    expect(matchesShortcut(ev("Enter"), "shift+enter", false)).toBe(false);
    expect(matchesShortcut(ev("e", { altKey: true }), "alt+e", true)).toBe(
      true,
    );
    expect(matchesShortcut(ev("j", { ctrlKey: true }), "mod+k", false)).toBe(
      false,
    );
  });
  it("compares the key without regard to case", () => {
    expect(matchesShortcut(ev("E"), "e", false)).toBe(true);
    expect(matchesShortcut(ev("Escape"), "escape", true)).toBe(true);
    expect(matchesShortcut(ev("e"), "E", false)).toBe(true);
  });
  it("matches any single printable character", () => {
    expect(matchesShortcut(ev("\\", { ctrlKey: true }), "mod+\\", false)).toBe(
      true,
    );
    expect(matchesShortcut(ev("\\", { metaKey: true }), "mod+\\", true)).toBe(
      true,
    );
    expect(matchesShortcut(ev("\\", { metaKey: true }), "mod+\\", false)).toBe(
      false,
    );
    expect(matchesShortcut(ev("\\"), "mod+\\", false)).toBe(false);
    expect(matchesShortcut(ev("/"), "/", false)).toBe(true);
    expect(matchesShortcut(ev("."), "/", false)).toBe(false);
    expect(matchesShortcut(ev("+", { ctrlKey: true }), "mod++", false)).toBe(
      true,
    );
  });
});
