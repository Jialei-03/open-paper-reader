/**
 * Where the same place of the paper is in its translation. A position is a
 * page index from 0 plus how far down the page it is (11.25: a quarter of the
 * way down the twelfth page), as `PdfController.position` gives it.
 */

/** One unit of the job's `alignment`: where its text was found in each PDF (`null`: not found for sure). */
export interface AlignmentUnit {
  source?: { page?: number } | null;
  translated?: { page?: number } | null;
}

/** A known pair: the top of a page of one PDF is the top of a page of the other. */
type Anchor = readonly [from: number, to: number];

/** Maps a position of one PDF to the other's, and back. */
export interface ScrollMap {
  /** From the original's position to the translation's. */
  forward(position: number): number;
  /** From the translation's position to the original's. */
  backward(position: number): number;
  /** How many pairs of pages the job's alignment gave (0: the pages are matched by their proportion). */
  anchors: number;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
};

/** The longest run of anchors that never goes back in the other PDF (a wrong match is left out). */
function steady(anchors: Anchor[]): Anchor[] {
  const length: number[] = [];
  const before: number[] = [];
  let best = -1;
  anchors.forEach((anchor, index) => {
    length[index] = 1;
    before[index] = -1;
    for (let other = 0; other < index; other++)
      if (anchors[other][1] <= anchor[1] && length[other] + 1 > length[index]) {
        length[index] = length[other] + 1;
        before[index] = other;
      }
    if (best < 0 || length[index] > length[best]) best = index;
  });
  const run: Anchor[] = [];
  for (let at = best; at >= 0; at = before[at]) run.unshift(anchors[at]);
  return run;
}

/** Pairs sharing a place are one pair at the mean; the places run up. */
function distinct(anchors: Anchor[]): Anchor[] {
  const out: Anchor[] = [];
  let group: Anchor[] = [];
  const flush = () => {
    if (!group.length) return;
    out.push([
      group[0][0],
      group.reduce((sum, [, to]) => sum + to, 0) / group.length,
    ]);
    group = [];
  };
  for (const anchor of [...anchors].sort((a, b) => a[0] - b[0])) {
    if (group.length && group[0][0] !== anchor[0]) flush();
    group.push(anchor);
  }
  flush();
  return out;
}

function interpolate(anchors: Anchor[], value: number): number {
  if (value <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (value >= last[0]) return last[1];
  let low = 0;
  let high = anchors.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (anchors[middle][0] <= value) low = middle;
    else high = middle;
  }
  const [x0, y0] = anchors[low];
  const [x1, y1] = anchors[high];
  return y0 + ((value - x0) / (x1 - x0)) * (y1 - y0);
}

/**
 * The map between the pages of the original (`sourcePages`) and of the
 * translation (`translatedPages`). The job's alignment says which page of the
 * translation each page of the original's text came to; the top of the first
 * and the end of the last are always a pair, and between the pairs the
 * position is carried in proportion. With no alignment (a layout translation
 * has none), that is all the map is: page for page, in proportion.
 */
export function scrollMap(
  alignment: readonly AlignmentUnit[] | null | undefined,
  sourcePages: number,
  translatedPages: number,
): ScrollMap {
  const found = new Map<number, number[]>();
  for (const unit of alignment ?? []) {
    const from = unit.source?.page;
    const to = unit.translated?.page;
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from! < 1 ||
      to! < 1 ||
      from! > sourcePages ||
      to! > translatedPages
    )
      continue;
    found.set(from!, [...(found.get(from!) ?? []), to!]);
  }
  const pairs = steady(
    [...found]
      .sort((a, b) => a[0] - b[0])
      .map(([from, tos]): Anchor => [from - 1, median(tos) - 1]),
  );
  const ends = (anchors: Anchor[], from: number, to: number): Anchor[] => [
    ...(anchors[0]?.[0] === 0 ? [] : [[0, 0] as Anchor]),
    ...anchors,
    ...(anchors.at(-1)?.[0] === from ? [] : [[from, to] as Anchor]),
  ];
  const forward = distinct(ends(pairs, sourcePages, translatedPages));
  const backward = distinct(
    ends(
      pairs.map(([from, to]): Anchor => [to, from]),
      translatedPages,
      sourcePages,
    ),
  );
  return {
    forward: (position) => interpolate(forward, position),
    backward: (position) => interpolate(backward, position),
    anchors: pairs.length,
  };
}

/** How many units of the alignment name a page in both PDFs: 0 means the panes are matched by proportion. */
export function alignedUnits(
  alignment: readonly AlignmentUnit[] | null | undefined,
): number {
  return (alignment ?? []).filter(
    (unit) => unit.source?.page && unit.translated?.page,
  ).length;
}
