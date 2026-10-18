import { parseReaderRoute, type ReaderRoute } from "../route";

/**
 * Where a link written in a note leads in the new reader, if it leads into a
 * paper. Notes written in the old reader link to `#paper/<id>?…`; the new one
 * writes `#read/<id>?…`; both open the paper here. Anything else (another page
 * of the workspace, a web address) is not the reader's to open: `null`.
 */
export function readerRouteOf(href: string): ReaderRoute | null {
  if (!href.startsWith("#")) return null;
  const hash = href.slice(1);
  return parseReaderRoute(
    hash.startsWith("paper/") ? `read/${hash.slice("paper/".length)}` : hash,
  );
}
