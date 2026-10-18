/**
 * The page each paper was last read at, kept on this device for each person
 * (`paper-last-page:<owner>`, one `{ [paperId]: page }` object): the reader
 * opens a paper there again. Device-local like `lib/recent-papers`; nothing here
 * throws, since storage can be unavailable (private browsing) or full.
 */

/** How many papers are remembered: past this the one remembered longest ago is forgotten. */
const MAX_PAPERS = 1000;
/** The pages that are remembered, 1 to this. */
const MAX_PAGE = 3000;
/** What a paper's id looks like (as in the reader's address). */
const PAPER_ID = /^[a-zA-Z0-9-]{1,64}$/;

const keyOf = (owner: string) => `paper-last-page:${owner}`;

const isPage = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= MAX_PAGE;

/**
 * What is stored, least recently remembered first (the order the object was
 * written in; ids are uuids, which an object never reorders, as it would a
 * number); entries that are not a paper's page are left out.
 */
function stored(owner: string): Map<string, number> {
  const pages = new Map<string, number>();
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(keyOf(owner)) || "{}",
    );
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return pages;
    for (const [id, page] of Object.entries(value))
      if (PAPER_ID.test(id) && isPage(page)) pages.set(id, page);
  } catch {
    /* Storage may be unavailable, or hold something else: nothing is remembered. */
  }
  return pages;
}

/** The page `paperId` was last read at on this device, or `null` if not remembered. */
export function lastPage(owner: string, paperId: string): number | null {
  return stored(owner).get(paperId) ?? null;
}

/** Remembers that `paperId` was read at `page` (a whole number from 1 to 3000; anything else is ignored). */
export function rememberPage(owner: string, paperId: string, page: number) {
  if (!PAPER_ID.test(paperId) || !isPage(page)) return;
  try {
    const pages = stored(owner);
    // Set again, a paper moves to the end: the newest.
    pages.delete(paperId);
    pages.set(paperId, page);
    for (const oldest of pages.keys()) {
      if (pages.size <= MAX_PAPERS) break;
      pages.delete(oldest);
    }
    localStorage.setItem(
      keyOf(owner),
      JSON.stringify(Object.fromEntries(pages)),
    );
  } catch {
    /* Storage may be unavailable or full. */
  }
}
