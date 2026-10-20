import { describe, expect, it } from "vitest";
import { parseAppRoute } from "./routes";

describe("parseAppRoute", () => {
  it("reads the screens, home by default", () => {
    expect(parseAppRoute("")).toEqual({ screen: "home" });
    expect(parseAppRoute("home")).toEqual({ screen: "home" });
    expect(parseAppRoute("library?q=x")).toEqual({ screen: "library" });
    expect(parseAppRoute("settings")).toEqual({ screen: "settings" });
    expect(parseAppRoute("settings/environments")).toEqual({
      screen: "settings",
      category: "environments",
    });
  });

  it("opens a paper in the reader", () => {
    expect(parseAppRoute("read/p1?page=3")).toEqual({
      screen: "reader",
      reader: { paperId: "p1", page: 3 },
    });
  });

  it("takes the old reader's address to the new one, with its place", () => {
    expect(
      parseAppRoute("paper/p1?file=f1&page=2&quote=a%20b&prefix=c&note=n"),
    ).toEqual({
      screen: "reader",
      reader: {
        paperId: "p1",
        fileId: "f1",
        page: 2,
        quote: "a b",
        prefix: "c",
      },
      redirect: "read/p1?file=f1&page=2&quote=a%20b&prefix=c",
    });
  });

  it("reads the discover screen", () => {
    expect(parseAppRoute("discover")).toEqual({ screen: "discover" });
  });

  it("sends what was taken out home", () => {
    for (const hash of [
      "dashboard",
      "knowledge",
      "directions",
      "collections/x",
      "tokens",
      "graph",
      "item/i1",
      "read/",
      "paper/!",
    ])
      expect(parseAppRoute(hash)).toEqual({ screen: "home", redirect: "home" });
  });
});

describe("parseAppRoute: #open", () => {
  it("reads the address the extension sends", () => {
    expect(
      parseAppRoute(
        "open?url=" + encodeURIComponent("https://a.org/p?x=1&y=2"),
      ),
    ).toEqual({ screen: "open", url: "https://a.org/p?x=1&y=2" });
  });

  it("sends a missing or odd address home", () => {
    expect(parseAppRoute("open")).toEqual({ screen: "home", redirect: "home" });
    expect(parseAppRoute("open?url=javascript:alert(1)")).toEqual({
      screen: "home",
      redirect: "home",
    });
  });
});

describe("parseAppRoute: #research", () => {
  it("reads the research list and a project", () => {
    expect(parseAppRoute("research")).toEqual({
      screen: "projects",
      redirect: "projects",
    });
    expect(
      parseAppRoute("research/0b6c2c1e-1d2f-4a3b-9c8d-7e6f5a4b3c2d"),
    ).toEqual({
      screen: "research",
      projectId: "0b6c2c1e-1d2f-4a3b-9c8d-7e6f5a4b3c2d",
    });
    expect(parseAppRoute("research/not-an-id")).toEqual({
      screen: "projects",
      redirect: "projects",
    });
  });

  it("reads the projects, one project, and one of its tabs", () => {
    const id = "0b6c2c1e-1d2f-4a3b-9c8d-7e6f5a4b3c2d";
    expect(parseAppRoute("projects")).toEqual({ screen: "projects" });
    expect(parseAppRoute(`projects/${id}`)).toEqual({
      screen: "projects",
      workspaceId: id,
    });
    expect(parseAppRoute(`projects/${id}/board`)).toEqual({
      screen: "projects",
      workspaceId: id,
      tab: "board",
    });
    expect(parseAppRoute(`projects/${id}/chats/${id}`)).toEqual({
      screen: "projects",
      workspaceId: id,
      tab: "chats",
      item: id,
    });
    expect(parseAppRoute(`projects/${id}/chats/x;y`)).toEqual({
      screen: "projects",
      workspaceId: id,
      tab: "chats",
    });
  });
});
