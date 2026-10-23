import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { createTranslator } from "../../i18n/i18n";
import {
  defaultPanelOpen,
  groupMessages,
  MessageRow,
  TeamComposer,
} from "./TeamScreen";
import { orderedMessages } from "./team-model";
import type { Team, TeamMessage } from "./team-api";

const started = "2026-10-23T15:27:00Z";
const finished = "2026-10-23T15:44:00Z";
const team: Team = {
  workspace_id: "workspace",
  channels: [],
  notifications: [],
  members: [
    {
      id: "human",
      role: "human",
      name: "human",
      status: "idle",
      active_run_id: null,
    },
    {
      id: "writer",
      role: "writer",
      name: "writer",
      status: "idle",
      active_run_id: null,
    },
    {
      id: "member",
      role: "librarian",
      name: "Ada",
      status: "working",
      active_run_id: "run",
    },
  ],
};
const message: TeamMessage = {
  id: "reply",
  channel_id: "channel",
  thread_id: "request",
  author_id: "member",
  kind: "message",
  text: "",
  mentions: [],
  data: {},
  replies: 0,
  created_at: started,
  run: {
    id: "run",
    status: "queued",
    response: "",
    error: "",
    steps: [],
    runtime: {},
    created_at: started,
    updated_at: started,
  },
};

describe("team member replies", () => {
  for (const locale of ["zh", "en"] as const) {
    const { t } = createTranslator(locale);
    const render = (value: TeamMessage, grouped = false) =>
      renderToStaticMarkup(
        createElement(I18nProvider, {
          locale,
          children: createElement(MessageRow, {
            message: value,
            grouped,
            modelName: "offline-model",
            team,
            openThread() {},
            fork() {},
            onFile() {},
          }),
        }),
      );

    it(`${locale} puts the researcher's message in its own bubble without an avatar or visible name`, () => {
      const html = render({
        ...message,
        author_id: "human",
        run: undefined,
        text: "My request",
      });
      expect(html).toContain('data-author="human"');
      expect(html).toContain(`aria-label="${t("team.member.human")}"`);
      expect(html).not.toContain('shape-rendering="crispEdges"');
      expect(html).not.toContain("<img");
      expect(html).not.toContain("<strong>");
      expect(html).toContain(`<time dateTime="${started}">`);
      expect(html).toContain("My request");
    });

    it(`${locale} keeps agent identity, handoff, model, files and replies accessible`, () => {
      const html = render({
        ...message,
        run: undefined,
        text: "Answer",
        replies: 3,
        data: {
          to: ["writer"],
          files: [{ path: "draft.md", name: "draft.md" }],
          attachments: [
            { id: "attachment", name: "data.csv", url: "/attachments/data" },
          ],
        },
      });
      expect(html).toContain('data-author="agent"');
      expect(html).toContain(t("team.agent"));
      expect(html).toContain(t("team.handoff", { name: "writer" }));
      expect(html).toContain("offline-model");
      expect(html).toContain(t("team.replies", { n: 3 }));
      expect(html).toContain('aria-label="draft.md"');
      expect(html).toContain('aria-label="data.csv"');
      expect(html).toContain(t("team.open"));
    });

    it(`${locale} groups consecutive agent messages without repeating their identity`, () => {
      const html = render(
        { ...message, run: undefined, text: "Follow-up" },
        true,
      );
      expect(html).toContain('data-grouped="true"');
      expect(html).not.toContain('shape-rendering="crispEdges"');
      expect(html).not.toContain("<img");
      expect(html).not.toContain("<strong>");
      expect(html).toContain("Follow-up");
      expect(html).toContain(`aria-label="${t("team.reply")}"`);
    });

    it(`${locale} centers system statuses without message actions or identity`, () => {
      const html = render({
        ...message,
        author_id: null,
        kind: "relay_limit",
        run: undefined,
        data: { waiting: true },
        text: "等你 / Waiting for you",
      });
      expect(html).toContain(`aria-label="${t("team.system")}"`);
      expect(html).toContain(`<span>${t("team.status.waiting")}</span>`);
      expect(html).not.toContain("<svg");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("<button");
      expect(html).not.toContain("<time");
    });

    it(`${locale} never invents an agent limit in a system notice`, () => {
      const html = render({
        ...message,
        author_id: null,
        kind: "relay_limit",
        run: undefined,
        data: {},
      });
      expect(html).toContain(t("team.limitReached"));
      expect(html).not.toContain(t("team.relayLimit", { n: 12 }));
    });

    it(`${locale} folds tools while preserving the answer and live status`, () => {
      const html = render({
        ...message,
        text: "Visible answer",
        run: {
          ...message.run!,
          status: "running",
          steps: [
            {
              name: "read",
              status: "completed",
              arguments: { path: "folded-path.md" },
            },
          ],
        },
      });
      expect(html).toContain('aria-expanded="false"');
      expect(html).toContain(t("team.status.working"));
      expect(html).not.toContain(t("research.process.done"));
      expect(html).not.toContain("folded-path.md");
      expect(html).toContain("Visible answer");
    });

    it(`${locale} addresses the conversation and exposes mention and attachment controls`, () => {
      for (const [member_id, name, label] of [
        [null, "闲聊", `#${t("team.channel.general")}`],
        ["member", "Ada", "Ada"],
        ["deleted-member", "Former member", "Former member"],
      ] as const) {
        const html = renderToStaticMarkup(
          createElement(I18nProvider, {
            locale,
            children: createElement(TeamComposer, {
              team,
              channel: {
                id: "channel",
                key: "general",
                name,
                member_id,
                unread: 0,
              },
              models: [],
              model: "",
              onModel() {},
              sent() {},
            }),
          }),
        );
        expect(html).toContain(
          `placeholder="${t("team.sendTo", { name: label })}"`,
        );
        expect(html).toContain(`aria-label="${t("team.mention")}"`);
        expect(html).toContain(`aria-label="${t("research.attach")}"`);
      }
    });

    it(`${locale} queues with only avatar, name, short status and stop`, () => {
      const html = render(message);
      expect(html).toContain(`<strong>Ada</strong>`);
      expect(html).toContain(`role="status">${t("team.queued")}</span>`);
      expect(html).toContain(`aria-label="${t("research.stop")}"`);
      expect(html).not.toContain(`aria-label="${t("team.reply")}"`);
      expect(html).not.toContain(`aria-label="${t("team.copy")}"`);
      expect(html).not.toContain("<time");
      expect(html).not.toContain("<section");
      expect(html).not.toContain(t("research.process.waitingTurn"));
    });

    it(`${locale} starts the normal working turn at its original time`, () => {
      const html = render({
        ...message,
        run: { ...message.run!, status: "running", updated_at: finished },
      });
      expect(html).toContain(`dateTime="${started}"`);
      expect(html).toContain('data-live="true"');
      expect(html).toContain(t("research.process.pending"));
      expect(html).not.toContain(t("team.queued"));
    });

    it(`${locale} displays the settled completion time and keeps the answer`, () => {
      const html = render({
        ...message,
        created_at: finished,
        text: "Saved answer",
        run: { ...message.run!, status: "completed", updated_at: finished },
      });
      expect(html).toContain(`dateTime="${finished}"`);
      expect(html).toContain("Saved answer");
      expect(html).not.toContain(`aria-label="${t("research.stop")}"`);
    });

    for (const steps of [
      [],
      [{ name: "read", status: "completed", arguments: { path: "notes.md" } }],
    ]) {
      it(`${locale} shows stopped after cancellation with ${steps.length} steps`, () => {
        const html = render({
          ...message,
          text: "Saved answer",
          run: { ...message.run!, status: "cancelled", steps },
        });
        expect(html).toContain(t("research.process.cancelled"));
        expect(html).toContain("Saved answer");
        expect(html).not.toContain(t("team.queued"));
        expect(html).not.toContain(`aria-label="${t("research.stop")}"`);
      });
      it(`${locale} labels a failure without an error with ${steps.length} steps`, () => {
        const html = render({
          ...message,
          text: "Saved answer",
          run: { ...message.run!, status: "failed", steps },
        });
        expect(html).toContain(t("research.process.failed"));
        expect(html).toContain("Saved answer");
        expect(html).not.toContain(t("team.queued"));
        expect(html).not.toContain(`aria-label="${t("research.stop")}"`);
      });
    }

    it(`${locale} keeps the failure and saved output visible`, () => {
      const html = render({
        ...message,
        text: "Saved answer",
        run: { ...message.run!, status: "failed", error: "Test failure" },
      });
      expect(html).toContain("Test failure");
      expect(html).toContain("Saved answer");
      expect(html).not.toContain(t("team.queued"));
      expect(html).not.toContain(t("research.process.cancelled"));
      expect(html).not.toContain(`aria-label="${t("research.stop")}"`);
    });
  }

  it("moves a settled reply after intervening messages without duplicating it", () => {
    const update = {
      ...message,
      id: "update",
      created_at: "2026-10-23T15:35:00Z",
    };
    expect(orderedMessages([message, update]).map((m) => m.id)).toEqual([
      "reply",
      "update",
    ]);
    const settled = { ...message, created_at: finished };
    expect(
      orderedMessages([message, update, settled]).map((m) => m.id),
    ).toEqual(["update", "reply"]);
    expect(message.created_at).toBe(started);
  });
});

describe("conversation grouping and panel defaults", () => {
  const first = { ...message, run: undefined };
  const next = { ...first, id: "next", created_at: "2026-10-23T15:32:00Z" };
  it("groups the same author through five minutes", () => {
    expect(groupMessages(first, next)).toBe(true);
    expect(groupMessages(first, { ...next, created_at: started })).toBe(true);
    expect(
      groupMessages(first, { ...next, created_at: "2026-10-23T15:32:01Z" }),
    ).toBe(false);
  });
  it("breaks at other authors, conversations, queued rows and system rows", () => {
    expect(groupMessages(undefined, next)).toBe(false);
    for (const patch of [
      { author_id: "writer" },
      { author_id: null },
      { channel_id: "other" },
      { thread_id: "other" },
      { kind: "budget" },
      { kind: "research" },
      { created_at: "invalid" },
      { created_at: "2026-10-23T15:26:59Z" },
      { run: message.run },
    ]) {
      expect(groupMessages(first, { ...next, ...patch })).toBe(false);
      expect(groupMessages({ ...first, ...patch }, next)).toBe(false);
    }
  });
  it("starts narrow screens closed and restores the desktop preference", () => {
    expect(defaultPanelOpen(899, null)).toBe(false);
    expect(defaultPanelOpen(899, "true")).toBe(false);
    expect(defaultPanelOpen(900, null)).toBe(true);
    expect(defaultPanelOpen(1440, "true")).toBe(true);
    expect(defaultPanelOpen(1440, "false")).toBe(false);
  });
});
