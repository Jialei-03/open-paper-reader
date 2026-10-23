import { describe, expect, it } from "vitest";
import {
  mentionMatches,
  memberLabel,
  mentionQuery,
  orderedMessages,
  sendMode,
} from "./team-model";
import { createTranslator } from "../../i18n/i18n";
import type { TeamMember, TeamMessage } from "./team-api";

const members: TeamMember[] = [
  {
    id: "advisor",
    role: "advisor",
    name: "导师",
    status: "working",
    active_run_id: "run",
  },
  {
    id: "writer",
    role: "writer",
    name: "写手",
    status: "idle",
    active_run_id: null,
  },
];
describe("team messages", () => {
  it("localizes built-in names and preserves chosen names", () => {
    const { t } = createTranslator("en");
    expect(memberLabel(members[0], t)).toBe("Advisor");
    expect(memberLabel({ ...members[0], name: "Ada" }, t)).toBe("Ada");
  });
  it("completes the mention at the caret, including Chinese and text after it", () => {
    expect(mentionQuery("hello @导 rest", 8)).toEqual({
      query: "导",
      start: 6,
      end: 8,
    });
    expect(mentionQuery("mail@example.com", 16)).toBeNull();
    expect(mentionMatches(members, "adv", (m) => m.name)).toEqual([members[0]]);
    expect(mentionMatches(members, "写", (m) => m.name)).toEqual([members[1]]);
  });
  it("queues Enter and sends immediately with either platform modifier", () => {
    expect(sendMode({ metaKey: false, ctrlKey: false })).toBe("queue");
    expect(sendMode({ metaKey: true, ctrlKey: false })).toBe("immediate");
    expect(sendMode({ metaKey: false, ctrlKey: true })).toBe("immediate");
  });
  it("assembles live messages once, in order, with normalized handoffs", () => {
    const first = {
      id: "a",
      created_at: "2026-01-01",
      text: "before",
    } as TeamMessage;
    const second = {
      id: "b",
      created_at: "2026-01-02",
      text: "later",
    } as TeamMessage;
    const updated = { ...first, text: "line1\\nline2" };
    expect(
      orderedMessages([second, first, updated]).map((m) => m.text),
    ).toEqual(["line1\nline2", "later"]);
  });
});
