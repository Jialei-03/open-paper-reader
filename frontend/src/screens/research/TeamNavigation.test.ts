import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { createTranslator } from "../../i18n/i18n";
import { TeamConversationList } from "./TeamNavigation";
import type { Team, TeamChannel } from "./team-api";

const channel = (
  id: string,
  member: string | null,
  at: string,
): TeamChannel => ({
  id,
  key: id,
  name: id,
  member_id: member,
  unread: 0,
  last_at: at,
  last_message: {
    author_id: member,
    author_name: "System",
    text: `Preview ${id}`,
    created_at: at,
  },
  working_member_ids: [],
});
const newChannel = "10000000-0000-4000-8000-000000000001";
const team: Team = {
  workspace_id: "workspace",
  members: Array.from({ length: 8 }, (_, index) => ({
    id: `member-${index}`,
    role: "custom",
    name: `Member ${index}`,
    avatar_color: "amber",
    status: index === 0 ? "working" : "idle",
    active_run_id: null,
    deleted: index === 6,
  })),
  channels: [
    channel("channel-old", null, "2026-10-20T00:00:00Z"),
    ...Array.from({ length: 7 }, (_, index) =>
      channel(`dm-${index}`, `member-${index}`, `2026-10-2${index}T00:00:00Z`),
    ),
    { ...channel("channel-new", null, "2026-10-24T01:00:00Z"), id: newChannel },
    {
      ...channel("empty-dm", "member-7", "2026-10-27T00:00:00Z"),
      last_message: null,
    },
    channel("missing-member", "absent", "2026-10-28T00:00:00Z"),
  ],
  notifications: [],
  threads_unread: 123,
  mentions_unread: 7,
};
const render = (value = team, locale: "zh" | "en" = "zh") =>
  renderToStaticMarkup(
    createElement(I18nProvider, {
      locale,
      children: createElement(TeamConversationList, {
        team: value,
        id: "workspace",
        hash: `team/10000000-0000-4000-8000-000000000002/${newChannel}`,
        go() {},
        onCreate() {},
      }),
    }),
  );

describe("team conversation navigation", () => {
  it("merges channels and DMs by activity and excludes deleted or missing members", () => {
    const html = render();
    const list = html.split('aria-labelledby="team-conversations"')[1];
    expect(
      [...list.matchAll(/href="#team\/workspace\/([^"?]+)"/g)].map(
        (match) => match[1],
      ),
    ).toEqual([
      "empty-dm",
      "dm-5",
      newChannel,
      "dm-4",
      "dm-3",
      "dm-2",
      "dm-1",
      "channel-old",
      "dm-0",
      "settings",
    ]);
    expect(html).toContain('aria-label="channel-new" aria-current="page"');
    expect(html).not.toContain("missing-member");
    expect(html).not.toContain("Member 6");
    expect(team.channels[0].id).toBe("channel-old");
  });

  it("shows the five most recent members with message history as DM shortcuts", () => {
    const html = render();
    const frequent = html.split('aria-label="常用成员"')[1].split("</div>")[0];
    expect(
      [...frequent.matchAll(/href="#team\/workspace\/([^"?]+)"/g)].map(
        (match) => match[1],
      ),
    ).toEqual(["dm-5", "dm-4", "dm-3", "dm-2", "dm-1"]);
    expect(frequent).toContain("<svg");
    expect(frequent).not.toContain("empty-dm");
    expect(render({ ...team, channels: [] })).not.toContain(
      'aria-label="常用成员"',
    );
  });

  for (const locale of ["zh", "en"] as const) {
    it(`${locale} only shows frequent members with at least three eligible DMs`, () => {
      const { t } = createTranslator(locale);
      const eligible = team.channels.filter((c) =>
        ["dm-0", "dm-1", "dm-2"].includes(c.id),
      );
      for (const count of [0, 1, 2, 3]) {
        const html = render(
          {
            ...team,
            channels: [
              ...eligible.slice(0, count),
              ...team.channels.filter((c) =>
                ["empty-dm", "dm-6", "missing-member", "channel-old"].includes(
                  c.id,
                ),
              ),
            ],
          },
          locale,
        );
        expect(html.includes(`aria-label="${t("team.frequentMembers")}"`)).toBe(
          count >= 3,
        );
        for (const c of eligible.slice(0, count))
          expect(html).toContain(`href="#team/workspace/${c.id}"`);
      }
    });

    it(`${locale} shows per-conversation work and numeric unread badges`, () => {
      const html = render(
        {
          ...team,
          channels: team.channels.map((c) =>
            c.id === newChannel
              ? { ...c, unread: 42, working_member_ids: ["member-0"] }
              : c,
          ),
        },
        locale,
      );
      expect(html).toContain(locale === "zh" ? "工作中…" : "Working…");
      expect(html).not.toContain("Preview channel-new");
      expect(html).toContain(
        locale === "zh" ? "Member 0：Preview dm-0" : "Member 0: Preview dm-0",
      );
      for (const count of [123, 7, 42])
        expect(html).toContain(
          `aria-label="${locale === "zh" ? `${count} 条未读` : `${count} unread`}">${count}</span>`,
        );
      expect(html).toContain('data-status="working"');
      expect(html).toContain('aria-label="channel-new"');
      expect(html).toContain(locale === "zh" ? "消息" : "Messages");
      expect(html).toContain(
        locale === "zh"
          ? 'aria-label="新建频道"'
          : 'aria-label="Create channel"',
      );
    });
  }
});
