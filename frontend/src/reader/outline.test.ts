import { describe, expect, it } from "vitest";
import {
  destinationPage,
  destinationPoint,
  linkTarget,
  loadOutline,
  resolveDestination,
  type LinkSource,
  type OutlineSource,
} from "./outline";

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

describe("resolveDestination", () => {
  it("gives the page and the array that says where on it", async () => {
    const at = [ref(6), { name: "XYZ" }, 40, 700, null];
    const doc = document(null, { named: { "cite.a": at } });
    expect(await resolveDestination(doc, "cite.a")).toEqual({
      page: 7,
      target: at,
    });
    expect(await resolveDestination(doc, "nothing")).toBeNull();
  });
});

describe("destinationPoint", () => {
  it("reads the point each kind of destination names", () => {
    const page = ref(0);
    expect(destinationPoint([page, { name: "XYZ" }, 40, 700, 0])).toEqual({
      left: 40,
      top: 700,
    });
    expect(destinationPoint([page, { name: "FitH" }, 500])).toEqual({
      left: null,
      top: 500,
    });
    expect(destinationPoint([page, { name: "FitBH" }, 320])).toEqual({
      left: null,
      top: 320,
    });
    expect(
      destinationPoint([page, { name: "FitR" }, 10, 100, 300, 600]),
    ).toEqual({ left: 10, top: 600 });
  });

  it("is null where the destination leaves the place as it is, or names none", () => {
    const page = ref(0);
    expect(destinationPoint([page, { name: "XYZ" }, null, null, 0])).toEqual({
      left: null,
      top: null,
    });
    expect(destinationPoint([page, { name: "Fit" }])).toEqual({
      left: null,
      top: null,
    });
    expect(destinationPoint([page])).toEqual({ left: null, top: null });
    expect(
      destinationPoint([page, { name: "XYZ" }, Number.NaN, Infinity]),
    ).toEqual({ left: null, top: null });
  });
});

describe("linkTarget", () => {
  /** Pages of 600 × 800 units; the PDF counts up from the bottom, the screen down from the top. */
  function linked(named: Record<string, unknown[]>, pageFails = false) {
    return {
      ...document(null, { named }),
      getPage: async () => {
        if (pageFails) throw new Error("unreadable page");
        return {
          getViewport: () => ({
            width: 600,
            height: 800,
            convertToViewportPoint: (x: number, y: number) => [x, 800 - y],
          }),
        };
      },
    } as unknown as LinkSource;
  }

  it("lands on the page, as far down it as the destination says", async () => {
    const doc = linked({
      high: [ref(4), { name: "XYZ" }, 0, 600, null],
      whole: [ref(2), { name: "Fit" }],
      above: [ref(1), { name: "FitH" }, 900],
    });
    expect(await linkTarget(doc, "high")).toEqual({ page: 5, offset: 0.25 });
    expect(await linkTarget(doc, "whole")).toEqual({ page: 3, offset: 0 });
    // A point above the page is its top.
    expect(await linkTarget(doc, "above")).toEqual({ page: 2, offset: 0 });
    expect(await linkTarget(doc, "missing")).toBeNull();
    // With room above the line it names.
    expect(await linkTarget(doc, "high", 40)).toEqual({ page: 5, offset: 0.2 });
  });

  it("still lands on the page when the page cannot be read", async () => {
    const doc = linked({ high: [ref(4), { name: "XYZ" }, 0, 600] }, true);
    expect(await linkTarget(doc, "high")).toEqual({ page: 5, offset: 0 });
  });
});
