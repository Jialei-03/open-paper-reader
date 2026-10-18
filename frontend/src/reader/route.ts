/**
 * The address of the reader: `#read/<paperId>`, and after a `?` where to be in
 * it. The reference (`quote`, `prefix`) is what a link into a paper carries to
 * find a sentence again; `rect` is the region of a page. Pure functions, so the
 * screen, the links and the tests all read an address the same way.
 */
export type ReaderRoute = {
  paperId: string;
  fileId?: string;
  page?: number;
  quote?: string;
  prefix?: string;
  rect?: string;
};

const PAPER_ID = /^[a-zA-Z0-9-]{1,64}$/;
const POSITIVE_INTEGER = /^\d+$/;

/** In the order they are written. */
const PARAMETERS = [
  ["file", "fileId"],
  ["page", "page"],
  ["quote", "quote"],
  ["prefix", "prefix"],
  ["rect", "rect"],
] as const;

/**
 * Reads `read/<id>?file=…&page=…&quote=…&prefix=…&rect=…` (the hash without its
 * `#`). Anything else, and an id that is not a paper id, is `null`. A parameter
 * that is empty is left out, and so is a `page` that is not a whole number from 1.
 */
export function parseReaderRoute(hash: string): ReaderRoute | null {
  if (!hash.startsWith("read/")) return null;
  const rest = hash.slice("read/".length);
  const query = rest.indexOf("?");
  const paperId = query < 0 ? rest : rest.slice(0, query);
  if (!PAPER_ID.test(paperId)) return null;

  const route: ReaderRoute = { paperId };
  if (query < 0) return route;
  const params = new URLSearchParams(rest.slice(query + 1));

  const file = params.get("file");
  if (file) route.fileId = file;
  const page = params.get("page");
  if (page && POSITIVE_INTEGER.test(page)) {
    const number = Number(page);
    if (Number.isSafeInteger(number) && number >= 1) route.page = number;
  }
  const quote = params.get("quote");
  if (quote) route.quote = quote;
  const prefix = params.get("prefix");
  if (prefix) route.prefix = prefix;
  const rect = params.get("rect");
  if (rect) route.rect = rect;
  return route;
}

/** The address of a route, with its `#`; the inverse of `parseReaderRoute`. */
export function readerHash(route: ReaderRoute): string {
  const query: string[] = [];
  for (const [name, key] of PARAMETERS) {
    const value = route[key];
    if (value === undefined || value === "") continue;
    query.push(`${name}=${encodeURIComponent(String(value))}`);
  }
  const path = `#read/${route.paperId}`;
  return query.length ? `${path}?${query.join("&")}` : path;
}

/** The part of a click that tells whose it is: the page's, or the browser's. */
interface LinkClick {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  preventDefault(): void;
}

/**
 * The click handler of a link whose address is `hash` (without its `#`): a plain
 * click goes there through `go`, as the page does everywhere; one that asks for
 * a new tab or window (a modifier key, the middle button) is left to the browser.
 */
export function followLink(go: (hash: string) => void, hash: string) {
  return (event: LinkClick) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    go(hash);
  };
}
