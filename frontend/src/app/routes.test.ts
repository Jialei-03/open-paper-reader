import { describe, expect, it } from "vitest";
import { parseAppRoute } from "./routes";

describe("parseAppRoute", () => {
  it("reads the screens, new research by default", () => {
    expect(parseAppRoute("")).toEqual({ screen: "new-research" });
    expect(parseAppRoute("home")).toEqual({ screen: "home" });
    expect(parseAppRoute("library?q=x")).toEqual({ screen: "library" });
    expect(parseAppRoute("settings")).toEqual({ screen: "settings" });
    expect(parseAppRoute("settings/environments")).toEqual({
      screen: "customize",
      section: "machines",
      redirect: "customize/machines",
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

describe("research navigation", () => {
  const id = "0b6c2c1e-1d2f-4a3b-9c8d-7e6f5a4b3c2d";
  it("starts empty, then routes a real research thread", () => {
    expect(parseAppRoute("new")).toEqual({ screen: "new-research" });
    expect(parseAppRoute(`new?workspace=${id}&collection=${id}`)).toEqual({
      screen: "new-research",
      workspaceId: id,
      collectionId: id,
    });
    expect(parseAppRoute(`research/${id}`)).toEqual({
      screen: "research",
      projectId: id,
    });
    expect(parseAppRoute("research")).toEqual({
      screen: "new-research",
      redirect: "new",
    });
    expect(parseAppRoute("research/not-an-id")).toEqual({
      screen: "new-research",
      redirect: "new",
    });
  });
  it("separates physical workspaces, classifications, and the selected board", () => {
    expect(parseAppRoute("workspaces")).toEqual({ screen: "workspaces" });
    expect(parseAppRoute(`workspaces/${id}/results`)).toEqual({
      screen: "workspaces",
      workspaceId: id,
      tab: "results",
    });
    expect(parseAppRoute("collections")).toEqual({
      screen: "research-collections",
    });
    expect(parseAppRoute(`collections/${id}`)).toEqual({
      screen: "research-collections",
      collectionId: id,
    });
    expect(parseAppRoute("collections/unclassified")).toEqual({
      screen: "research-collections",
      collectionId: "unclassified",
    });
    expect(parseAppRoute("board")).toEqual({
      screen: "workspaces",
      redirect: "workspaces",
    });
  });
  it("maps old projects to folders and preserves saved ordinary-chat links", () => {
    expect(parseAppRoute("projects")).toEqual({
      screen: "research-collections",
      redirect: "collections",
    });
    expect(parseAppRoute(`projects/${id}`)).toEqual({
      screen: "workspaces",
      workspaceId: id,
      redirect: `workspaces/${id}`,
    });
    expect(parseAppRoute(`projects/${id}/results`)).toEqual({
      screen: "workspaces",
      workspaceId: id,
      tab: "results",
      redirect: `workspaces/${id}/results`,
    });
    expect(parseAppRoute(`projects/${id}/board`)).toEqual({
      screen: "workspaces",
      workspaceId: id,
      tab: "board",
      redirect: `workspaces/${id}/board`,
    });
    expect(parseAppRoute(`projects/${id}/chats/${id}`)).toEqual({
      screen: "projects",
      workspaceId: id,
      tab: "chats",
      item: id,
    });
  });
});

describe("section navigation", () => {
  const id = "0b6c2c1e-1d2f-4a3b-9c8d-7e6f5a4b3c2d";
  it("opens schedules and redirects the retired task center", () => {
    expect(parseAppRoute("schedules")).toEqual({ screen: "schedules" });
    expect(parseAppRoute(`schedules/${id}`)).toEqual({
      screen: "schedules",
      scheduleId: id,
    });
    expect(parseAppRoute("schedules/new?template=papers")).toEqual({
      screen: "schedules",
      scheduleId: "new",
      template: "papers",
    });
    expect(parseAppRoute("schedules/new?template=unknown")).toEqual({
      screen: "schedules",
      scheduleId: "new",
    });
    expect(parseAppRoute("schedules/invalid")).toEqual({
      screen: "schedules",
      redirect: "schedules",
    });
    for (const path of [
      "tasks",
      "tasks/active",
      `tasks/waiting?research=${id}`,
    ])
      expect(parseAppRoute(path)).toEqual({
        screen: "schedules",
        redirect: "schedules",
      });
  });
  it("opens real customization pages and normalizes unknown subsections", () => {
    expect(parseAppRoute("customize/models")).toEqual({
      screen: "customize",
      section: "models",
    });
    expect(parseAppRoute("customize/playbook")).toEqual({
      screen: "customize",
      section: "playbook",
    });
    expect(parseAppRoute("customize/plugins")).toEqual({
      screen: "customize",
      section: "playbook",
      redirect: "customize/playbook",
    });
  });
});

describe("customize categories", () => {
  it.each(["playbook", "roles", "machines", "tracking", "models", "workflows"])(
    "opens %s",
    (section) => {
      expect(parseAppRoute(`customize/${section}`)).toEqual({
        screen: "customize",
        section,
      });
    },
  );
  it.each([
    ["environments", "machines"],
    ["tracking", "tracking"],
    ["models", "models"],
    ["playbook", "playbook"],
  ])("redirects settings/%s into customize", (category, section) => {
    expect(parseAppRoute(`settings/${category}?q=old`)).toEqual({
      screen: "customize",
      section,
      redirect: `customize/${section}`,
    });
  });
});
