import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "../../api";
import { SectionNavigation } from "../../app/SectionNavigation";
import { I18nProvider } from "../../i18n/I18nProvider";
import { LibraryScreen } from "../LibraryScreen";

vi.mock("../../lib/cite", async (original) => ({
  ...(await original<object>()),
  useMetadataMap: () => ({ map: {}, ready: false }),
  useMetadataFill: () => undefined,
}));

const opened = Date.UTC(2026, 9, 21, 9);
const papers: Paper[] = [
  {
    id: "p1",
    title: "Attention Is All You Need",
    authors: "A. Author, B. Author",
    abstract: "",
    external_id: "arxiv:1706.03762",
    tags: [],
    current_version: "v1",
    agent_status: "idle",
    reading_status: "reading",
    favorite: false,
    archived: false,
    revision: 1,
    updated_at: "2026-10-23T10:00:00Z",
  },
  {
    id: "p2",
    title: "Unread Paper",
    authors: "C. Author",
    abstract: "",
    external_id: "",
    tags: [],
    current_version: "v2",
    agent_status: "idle",
    reading_status: "unread",
    favorite: false,
    archived: false,
    revision: 1,
    updated_at: "2026-10-23T10:00:00Z",
  },
];
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map([["paper-recent:owner", JSON.stringify({ p1: opened })]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
  });
  vi.stubGlobal("location", { hash: "#library" });
});
afterEach(() => vi.unstubAllGlobals());

const library = () =>
  renderToStaticMarkup(
    createElement(I18nProvider, {
      locale: "zh",
      children: createElement(LibraryScreen, {
        owner: "owner",
        papers,
        go: vi.fn(),
        reload: vi.fn(),
      }),
    }),
  );

describe("materials layout", () => {
  it("starts with all papers, source and actual opened dates", () => {
    const html = library();
    expect(html).toMatch(/<h1[^>]*>全部<\/h1>/);
    expect(html).toContain('data-view="list"');
    expect(html).toContain("上次打开时间");
    expect(html).toContain('dateTime="2026-10-21T09:00:00.000Z"');
    expect(html).not.toContain('dateTime="2026-10-23');
    expect(html).toContain('title="arXiv"');
    expect(html).not.toContain('aria-label="阅读状态"');
    expect(html).not.toContain("导入、整理并阅读");
  });

  it("uses the sidebar category and search together", () => {
    vi.stubGlobal("location", { hash: "#library?view=reading&q=attention" });
    const html = library();
    expect(html).toMatch(/<h1[^>]*>在读<\/h1>/);
    expect(html).toContain('data-paper="p1"');
    expect(html).not.toContain('data-paper="p2"');
    expect(html).toContain('value="attention"');
  });

  it("keeps the saved card view with cover, title and authors", () => {
    storage.set("paper-library-view", "grid");
    const html = library();
    expect(html).toContain('data-view="grid"');
    expect(html).toContain('data-thumb="placeholder"');
    expect(html).toContain("A. Author, B. Author");
    expect(html).not.toContain('role="progressbar"');
  });

  it("offers import for an empty category and clear search for an empty search", () => {
    vi.stubGlobal("location", { hash: "#library?view=read" });
    expect(library()).not.toContain("清除搜索");
    vi.stubGlobal("location", { hash: "#library?view=reading&q=missing" });
    const html = library();
    expect(html).toContain("清除搜索");
    expect(html).toMatch(/<h1[^>]*>在读<\/h1>/);
  });

  it("lists categories and recent reader links without home or trash", () => {
    const html = renderToStaticMarkup(
      createElement(I18nProvider, {
        locale: "zh",
        children: createElement(SectionNavigation, {
          section: "materials",
          route: { screen: "library" },
          hash: "library",
          reading: [{ id: "p1", title: papers[0].title }],
          go: vi.fn(),
        }),
      }),
    );
    for (const path of [
      "library",
      "library?view=reading",
      "library?view=unread",
      "library?view=read",
      "discover",
      "read/p1",
    ])
      expect(html).toContain(`href="#${path}"`);
    expect(html).not.toContain('href="#home"');
    expect(html).not.toContain("回收站");
  });
});
