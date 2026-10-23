import { describe, expect, it } from "vitest";
import {
  mentionMatches,
  memberLabel,
  mentionQuery,
  orderedMessages,
  recentThreads,
  sendMode,
  threadDate,
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

  it("orders threads by their last reply and keeps message chronology unchanged", () => {
    const old = {
      id: "old",
      created_at: "2026-01-01T00:00:00Z",
      text: "old",
    } as TeamMessage;
    const newer = { ...old, id: "newer", created_at: "2026-01-02T00:00:00Z" };
    const replied = { ...old, last_message_at: "2026-01-03T00:00:00Z" };
    expect(recentThreads([old, newer, replied]).map((m) => m.id)).toEqual([
      "old",
      "newer",
    ]);
    expect(orderedMessages([replied, newer]).map((m) => m.id)).toEqual([
      "old",
      "newer",
    ]);
    expect(old).not.toHaveProperty("last_message_at");
    const offset = { ...newer, last_message_at: "2026-01-03T09:00:00+08:00" };
    expect(recentThreads([offset, replied]).map((m) => m.id)).toEqual([
      "newer",
      "old",
    ]);
  });

  for (const locale of ["zh", "en"]) {
    it(`${locale} formats local today, this year and earlier dates`, () => {
      const now = new Date(2026, 9, 24, 15);
      expect(
        threadDate(new Date(2026, 9, 24, 0, 5).toISOString(), locale, now),
      ).toBe("00:05");
      const recent = threadDate(
        new Date(2026, 9, 23, 23, 59).toISOString(),
        locale,
        now,
      );
      expect(recent).toBe(locale === "zh" ? "10月23日" : "Oct 23");
      expect(
        threadDate(new Date(2025, 11, 31).toISOString(), locale, now),
      ).toBe(locale === "zh" ? "2025年12月31日" : "Dec 31, 2025");
      expect(threadDate("invalid", locale, now)).toBe("—");
      const january = new Date(2026, 0, 1);
      expect(
        threadDate(
          new Date(2025, 11, 31, 23, 59).toISOString(),
          locale,
          january,
        ),
      ).toContain("2025");
    });
  }
});
