import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { createTranslator } from "../../i18n/i18n";
import { MessageRow } from "./TeamScreen";
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
    const render = (value: TeamMessage) =>
      renderToStaticMarkup(
        createElement(I18nProvider, {
          locale,
          children: createElement(MessageRow, {
            message: value,
            team,
            openThread() {},
            fork() {},
            onFile() {},
          }),
        }),
      );

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
