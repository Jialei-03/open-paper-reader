import { describe, expect, it } from "vitest";
import { followLink, parseReaderRoute, readerHash } from "./route";

describe("parseReaderRoute", () => {
  it("parses a reader route with its reference", () => {
    expect(
      parseReaderRoute(
        "read/p-1?file=f-2&page=3&quote=Attention%20is&prefix=x",
      ),
    ).toEqual({
      paperId: "p-1",
      fileId: "f-2",
      page: 3,
      quote: "Attention is",
      prefix: "x",
    });
  });

  it("keeps the rect as it is written", () => {
    expect(parseReaderRoute("read/p?page=2&rect=0.1,0.2,0.5,0.6")).toEqual({
      paperId: "p",
      page: 2,
      rect: "0.1,0.2,0.5,0.6",
    });
  });

  it("takes a paper with no reference", () => {
    expect(parseReaderRoute("read/abc123")).toEqual({ paperId: "abc123" });
    expect(parseReaderRoute("read/abc123?")).toEqual({ paperId: "abc123" });
  });

  it("rejects other routes and bad ids", () => {
    expect(parseReaderRoute("paper/p-1")).toBeNull();
    expect(parseReaderRoute("read/../x")).toBeNull();
    expect(parseReaderRoute("read")).toBeNull();
    expect(parseReaderRoute("read/")).toBeNull();
    expect(parseReaderRoute("read/p-1/")).toBeNull();
    expect(parseReaderRoute("read/a b")).toBeNull();
    expect(parseReaderRoute(`read/${"a".repeat(65)}`)).toBeNull();
    expect(parseReaderRoute("reader/p-1")).toBeNull();
    expect(parseReaderRoute("#read/p-1")).toBeNull();
  });

  it("accepts the longest id", () => {
    const id = "a".repeat(64);
    expect(parseReaderRoute(`read/${id}`)).toEqual({ paperId: id });
  });

  it("ignores a page that is not a positive integer", () => {
    expect(parseReaderRoute("read/p?page=0")).toEqual({ paperId: "p" });
    expect(parseReaderRoute("read/p?page=2.5")).toEqual({ paperId: "p" });
    expect(parseReaderRoute("read/p?page=-1")).toEqual({ paperId: "p" });
    expect(parseReaderRoute("read/p?page=two")).toEqual({ paperId: "p" });
    expect(parseReaderRoute("read/p?page=")).toEqual({ paperId: "p" });
    expect(parseReaderRoute("read/p?page=99999999999999999999")).toEqual({
      paperId: "p",
    });
  });

  it("leaves out parameters that are empty", () => {
    expect(parseReaderRoute("read/p?file=&quote=&page=4")).toEqual({
      paperId: "p",
      page: 4,
    });
  });

  it("survives a percent sign that is not an escape", () => {
    expect(parseReaderRoute("read/p?quote=100%")).toEqual({
      paperId: "p",
      quote: "100%",
    });
  });
});

describe("readerHash", () => {
  it("writes only the parameters that have a value, in a fixed order", () => {
    expect(readerHash({ paperId: "p" })).toBe("#read/p");
    expect(
      readerHash({
        rect: "1,2,3,4",
        prefix: "c",
        quote: "q",
        page: 4,
        fileId: "f",
        paperId: "p",
      }),
    ).toBe("#read/p?file=f&page=4&quote=q&prefix=c&rect=1%2C2%2C3%2C4");
  });

  it("round-trips through parseReaderRoute", () => {
    const route = {
      paperId: "p",
      fileId: "f",
      page: 4,
      quote: "a & b",
      prefix: "c",
    };
    expect(parseReaderRoute(readerHash(route).slice(1))).toEqual(route);
  });

  it("round-trips text with symbols and non-Latin letters", () => {
    const route = {
      paperId: "p-9",
      quote: "注意力 = 100% + 50%? #1 a/b",
      prefix: "x=y&z",
    };
    expect(parseReaderRoute(readerHash(route).slice(1))).toEqual(route);
  });
});

describe("followLink", () => {
  const click = (
    init: Partial<Parameters<ReturnType<typeof followLink>>[0]>,
  ) => {
    let prevented = false;
    return {
      event: {
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
        preventDefault: () => {
          prevented = true;
        },
        ...init,
      },
      wasPrevented: () => prevented,
    };
  };

  it("takes a plain click through go", () => {
    const went: string[] = [];
    const { event, wasPrevented } = click({});
    followLink((hash) => went.push(hash), "library")(event);
    expect(went).toEqual(["library"]);
    expect(wasPrevented()).toBe(true);
  });

  it("leaves a click for a new tab, a new window or the menu to the browser", () => {
    for (const init of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
      { button: 2 },
      { defaultPrevented: true },
    ]) {
      const went: string[] = [];
      const { event, wasPrevented } = click(init);
      followLink((hash) => went.push(hash), "library")(event);
      expect(went, JSON.stringify(init)).toEqual([]);
      expect(wasPrevented(), JSON.stringify(init)).toBe(false);
    }
  });
});
