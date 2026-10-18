import { describe, expect, it } from "vitest";
import { destinationPage, loadOutline, type OutlineSource } from "./outline";

/** A document of `numPages` pages whose page objects are `{ num: 10 + index, gen: 0 }`. */
function document(
  outline: unknown,
  options: {
    numPages?: number;
    named?: Record<string, unknown[] | null>;
    outlineFails?: boolean;
    lookupFails?: boolean;
  } = {},
): OutlineSource {
  const pages = options.numPages ?? 20;
  return {
    numPages: pages,
    getOutline: async () => {
      if (options.outlineFails) throw new Error("no outline");
      return outline as never;
    },
    getDestination: async (name: string) => options.named?.[name] ?? null,
    getPageIndex: async (ref: { num: number }) => {
      if (options.lookupFails) throw new Error("not a page");
      return ref.num - 10;
    },
  } as unknown as OutlineSource;
}

const ref = (index: number) => ({ num: 10 + index, gen: 0 });

describe("destinationPage", () => {
  it("reads a reference, a page number and a name", async () => {
    const doc = document(null, {
      named: { chapter: [ref(6), { name: "Fit" }] },
    });
    expect(
      await destinationPage(doc, [ref(4), { name: "XYZ" }, 0, 0, null]),
    ).toBe(5);
    expect(await destinationPage(doc, [0, { name: "Fit" }])).toBe(1);
    expect(await destinationPage(doc, "chapter")).toBe(7);
  });

  it("is null for what leads nowhere, and never throws", async () => {
    const doc = document(null);
    expect(await destinationPage(doc, "nothing defines this")).toBeNull();
    expect(await destinationPage(doc, [])).toBeNull();
    expect(await destinationPage(doc, null)).toBeNull();
    expect(await destinationPage(doc, [ref(99)])).toBeNull();
    expect(await destinationPage(doc, [-3])).toBeNull();
    expect(await destinationPage(doc, [1.5])).toBeNull();
    expect(
      await destinationPage(document(null, { lookupFails: true }), [ref(2)]),
    ).toBeNull();
  });
});

describe("loadOutline", () => {
  it("flattens the tree in reading order with each entry's depth and page", async () => {
    const doc = document(
      [
        { title: "Intro", dest: [ref(1)], items: [] },
        {
          title: "Methods",
          dest: [ref(7)],
          items: [
            { title: "Data", dest: [ref(11)], items: [] },
            {
              title: "Training",
              dest: [ref(14)],
              items: [{ title: "Schedules", dest: [ref(15)], items: [] }],
            },
          ],
        },
        { title: "Results", dest: [ref(29 - 10)], items: [] },
      ],
      { numPages: 30 },
    );
    expect(await loadOutline(doc)).toEqual([
      { title: "Intro", depth: 0, page: 2 },
      { title: "Methods", depth: 0, page: 8 },
      { title: "Data", depth: 1, page: 12 },
      { title: "Training", depth: 1, page: 15 },
      { title: "Schedules", depth: 2, page: 16 },
      { title: "Results", depth: 0, page: 20 },
    ]);
  });

  it("keeps the title of an entry that cannot be followed", async () => {
    const doc = document([
      { title: "Fine", dest: [ref(2)], items: [] },
      { title: "Named, undefined", dest: "gone", items: [] },
      {
        title: "An address",
        dest: null,
        url: "https://example.org",
        items: [],
      },
      { title: "Past the end", dest: [ref(500)], items: [] },
    ]);
    expect(await loadOutline(doc)).toEqual([
      { title: "Fine", depth: 0, page: 3 },
      { title: "Named, undefined", depth: 0, page: null },
      { title: "An address", depth: 0, page: null },
      { title: "Past the end", depth: 0, page: null },
    ]);
  });

  it("has no entries without an outline, or when it cannot be read", async () => {
    expect(await loadOutline(document(null))).toEqual([]);
    expect(await loadOutline(document([]))).toEqual([]);
    expect(await loadOutline(document([], { outlineFails: true }))).toEqual([]);
  });

  it("does not follow a document into endless nesting, or an endless list", async () => {
    let deep: unknown = { title: "bottom", dest: [ref(1)], items: [] };
    for (let level = 0; level < 5000; level++)
      deep = { title: `level ${level}`, dest: [ref(1)], items: [deep] };
    const nested = await loadOutline(document([deep]));
    expect(nested.length).toBeLessThanOrEqual(8);
    expect(Math.max(...nested.map((node) => node.depth))).toBeLessThan(8);

    const wide = Array.from({ length: 10_000 }, (_, i) => ({
      title: `entry ${i}`,
      dest: [ref(1)],
      items: [],
    }));
    expect((await loadOutline(document(wide))).length).toBe(3000);
  });
});
