import { describe, expect, it } from "vitest";
import { readerRouteOf } from "./noteLink";

describe("readerRouteOf", () => {
  it("opens a link of the old reader in the new one", () => {
    expect(
      readerRouteOf("#paper/abc-1?file=f2&page=3&quote=a%20b&prefix=x"),
    ).toEqual({
      paperId: "abc-1",
      fileId: "f2",
      page: 3,
      quote: "a b",
      prefix: "x",
    });
    expect(readerRouteOf("#paper/abc-1")).toEqual({ paperId: "abc-1" });
  });

  it("reads a link of the new reader as it is", () => {
    expect(readerRouteOf("#read/abc-1?page=2")).toEqual({
      paperId: "abc-1",
      page: 2,
    });
  });

  it("leaves what is not a paper alone", () => {
    expect(readerRouteOf("#library")).toBeNull();
    expect(readerRouteOf("#item/abc")).toBeNull();
    expect(readerRouteOf("https://example.com/paper/abc")).toBeNull();
    expect(readerRouteOf("#paper/not an id")).toBeNull();
    expect(readerRouteOf("")).toBeNull();
  });
});
