import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lastPage, rememberPage } from "./page-memory";

/** A `localStorage` that lives in a Map (Node's own warns when touched). */
function storage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

let store: ReturnType<typeof storage>;
beforeEach(() => {
  store = storage();
  vi.stubGlobal("localStorage", store);
});
afterEach(() => vi.unstubAllGlobals());

const KEY = "paper-last-page:u1";
const saved = () => JSON.parse(store.items.get(KEY) ?? "{}");

describe("rememberPage and lastPage", () => {
  it("reads back what was remembered, for that paper and that person", () => {
    expect(lastPage("u1", "p-1")).toBeNull();
    rememberPage("u1", "p-1", 7);
    rememberPage("u1", "p-2", 12);
    expect(lastPage("u1", "p-1")).toBe(7);
    expect(lastPage("u1", "p-2")).toBe(12);
    expect(lastPage("u1", "p-3")).toBeNull();
    expect(lastPage("u2", "p-1")).toBeNull();
  });

  it("keeps the pages in one object per person, by paper", () => {
    rememberPage("u1", "p-1", 7);
    rememberPage("u1", "p-2", 12);
    expect(saved()).toEqual({ "p-1": 7, "p-2": 12 });
  });

  it("takes the latest page of a paper", () => {
    rememberPage("u1", "p-1", 7);
    rememberPage("u1", "p-1", 3);
    expect(lastPage("u1", "p-1")).toBe(3);
  });

  it("accepts 1 and 3000, the ends", () => {
    rememberPage("u1", "p-1", 1);
    rememberPage("u1", "p-2", 3000);
    expect(lastPage("u1", "p-1")).toBe(1);
    expect(lastPage("u1", "p-2")).toBe(3000);
  });

  it("does not remember a page that cannot be one", () => {
    rememberPage("u1", "p-1", 5);
    for (const page of [0, -1, 3001, 2.5, NaN, Infinity, "7" as never])
      rememberPage("u1", "p-1", page);
    expect(lastPage("u1", "p-1")).toBe(5);
    rememberPage("u1", "p-2", 0);
    expect(lastPage("u1", "p-2")).toBeNull();
    expect(saved()).toEqual({ "p-1": 5 });
  });

  it("does not remember a paper whose id is not one", () => {
    rememberPage("u1", "../x", 4);
    rememberPage("u1", "", 4);
    rememberPage("u1", "a".repeat(65), 4);
    expect(store.items.has(KEY)).toBe(false);
  });

  it("reads a page that cannot be one as nothing", () => {
    store.items.set(
      KEY,
      JSON.stringify({
        zero: 0,
        over: 3001,
        fraction: 2.5,
        text: "7",
        nothing: null,
        yes: true,
        list: [3],
        ok: 7,
        last: 3000,
        first: 1,
      }),
    );
    for (const id of ["zero", "over", "fraction", "text", "nothing", "yes"])
      expect(lastPage("u1", id)).toBeNull();
    expect(lastPage("u1", "list")).toBeNull();
    expect(lastPage("u1", "ok")).toBe(7);
    expect(lastPage("u1", "last")).toBe(3000);
    expect(lastPage("u1", "first")).toBe(1);
  });

  it("is not fooled by the names an object has of its own", () => {
    expect(lastPage("u1", "constructor")).toBeNull();
    expect(lastPage("u1", "toString")).toBeNull();
    rememberPage("u1", "constructor", 4);
    expect(lastPage("u1", "constructor")).toBe(4);
  });

  it("starts over from what is stored when that is not an object", () => {
    for (const raw of ["not json", "[1,2]", "null", '"7"', "7", ""]) {
      store.items.set(KEY, raw);
      expect(lastPage("u1", "p-1")).toBeNull();
      rememberPage("u1", "p-1", 9);
      expect(lastPage("u1", "p-1")).toBe(9);
    }
  });

  it("drops what is stored that is not valid when it writes", () => {
    store.items.set(KEY, JSON.stringify({ bad: 0, "p-1": 2 }));
    rememberPage("u1", "p-2", 6);
    expect(saved()).toEqual({ "p-1": 2, "p-2": 6 });
  });
});

describe("the limit", () => {
  it("keeps 1000 papers and drops the oldest", () => {
    for (let index = 0; index <= 1000; index++)
      rememberPage("u1", `p-${index}`, 2);
    expect(Object.keys(saved())).toHaveLength(1000);
    expect(lastPage("u1", "p-0")).toBeNull();
    expect(lastPage("u1", "p-1")).toBe(2);
    expect(lastPage("u1", "p-1000")).toBe(2);
  });

  it("counts a paper read again as the newest", () => {
    for (let index = 0; index < 1000; index++)
      rememberPage("u1", `p-${index}`, 2);
    rememberPage("u1", "p-0", 5);
    rememberPage("u1", "p-1000", 2);
    expect(Object.keys(saved())).toHaveLength(1000);
    expect(lastPage("u1", "p-0")).toBe(5);
    expect(lastPage("u1", "p-1")).toBeNull();
    expect(lastPage("u1", "p-2")).toBe(2);
  });

  it("does not drop anything for a paper that is already in", () => {
    for (let index = 0; index < 1000; index++)
      rememberPage("u1", `p-${index}`, 2);
    rememberPage("u1", "p-999", 8);
    expect(Object.keys(saved())).toHaveLength(1000);
    expect(lastPage("u1", "p-0")).toBe(2);
    expect(lastPage("u1", "p-999")).toBe(8);
  });
});

describe("when the storage cannot be used", () => {
  it("does not throw when reading or writing fails", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    });
    expect(() => rememberPage("u1", "p-1", 7)).not.toThrow();
    expect(lastPage("u1", "p-1")).toBeNull();
  });

  it("does not throw when only the writing fails", () => {
    vi.stubGlobal("localStorage", {
      ...store,
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    });
    expect(() => rememberPage("u1", "p-1", 7)).not.toThrow();
    expect(lastPage("u1", "p-1")).toBeNull();
  });

  it("does not throw when there is no storage at all", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => rememberPage("u1", "p-1", 7)).not.toThrow();
    expect(lastPage("u1", "p-1")).toBeNull();
  });
});
