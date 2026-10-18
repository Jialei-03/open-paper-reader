import { describe, expect, it } from "vitest";
import { parseAppRoute } from "./routes";

describe("parseAppRoute", () => {
  it("reads the screens, home by default", () => {
    expect(parseAppRoute("")).toEqual({ screen: "home" });
    expect(parseAppRoute("home")).toEqual({ screen: "home" });
    expect(parseAppRoute("library?q=x")).toEqual({ screen: "library" });
    expect(parseAppRoute("settings")).toEqual({ screen: "settings" });
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
