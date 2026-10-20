import { describe, expect, it } from "vitest";
import {
  matchCommands,
  parseCommand,
  slashQuery,
  type SlashCommand,
} from "./slash";

const command = (
  name: string,
  description = "",
  extra: Partial<SlashCommand> = {},
): SlashCommand => ({ name, description, run: () => undefined, ...extra });

const commands = [
  command("compact", "压缩上下文", { takesArgument: true }),
  command("copy", "复制上一条回答"),
  command("new", "新的对话"),
  command("model MiniMax-M3", "切换模型", { group: "model" }),
  command("model MiniMax-M3.1-Flash", "切换模型", { group: "model" }),
];

describe("slash commands", () => {
  it("opens on a slash and closes on a new line", () => {
    expect(slashQuery("hello")).toBeNull();
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/Comp")).toBe("comp");
    expect(slashQuery("/compact\nmore")).toBeNull();
  });

  it("ranks names that start with the query first and keeps groups together", () => {
    expect(matchCommands(commands, "co").map((c) => c.name)).toEqual([
      "compact",
      "copy",
    ]);
    expect(matchCommands(commands, "model").map((c) => c.name)).toEqual([
      "model MiniMax-M3",
      "model MiniMax-M3.1-Flash",
    ]);
    // The description matches too.
    expect(matchCommands(commands, "压缩").map((c) => c.name)).toEqual([
      "compact",
    ]);
    expect(matchCommands(commands, "zzz")).toEqual([]);
  });

  it("runs an exact command with its words, and leaves anything else a message", () => {
    expect(parseCommand("/compact 只留结论", commands)).toMatchObject({
      command: { name: "compact" },
      argument: "只留结论",
    });
    expect(parseCommand("/copy", commands)?.command.name).toBe("copy");
    // The longer name wins over a shorter one it starts with.
    expect(
      parseCommand("/model MiniMax-M3.1-Flash", commands)?.command.name,
    ).toBe("model MiniMax-M3.1-Flash");
    // Words after a command that takes none: a message after all.
    expect(parseCommand("/copy this", commands)).toBeNull();
    expect(parseCommand("/compacting", commands)).toBeNull();
    expect(parseCommand("hello /copy", commands)).toBeNull();
  });
});
