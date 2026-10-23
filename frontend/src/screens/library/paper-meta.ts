import type { Paper } from "../../api";
import type { PaperMetadata } from "../../lib/cite";

export function paperSource(paper: Paper, meta?: PaperMetadata | null) {
  const known = meta?.status === "ok" ? meta : null;
  if (known?.venue) return known.venue;
  const ids = paperIds(paper.external_id);
  return ids.arxiv || known?.arxiv
    ? "arXiv"
    : ids.doi || known?.doi
      ? "DOI"
      : "";
}

/** What a paper's `external_id` says it is, as far as it can be told. */
export interface PaperIds {
  /** An arXiv id without a version (`2301.12345`), when there is one. */
  arxiv: string;
  doi: string;
  /** The year an arXiv id was assigned in (its first two digits), or 0. */
  year: number;
}

const NEW_ARXIV = /(\d{2})(\d{2})\.\d{4,5}/;
const OLD_ARXIV = /[a-z-]+(?:\.[A-Z]{2})?\/(\d{2})(\d{2})\d{3}/i;
const DOI = /\b(10\.\d{4,9}\/[^\s"<>]+)/i;

export function paperIds(externalId: string): PaperIds {
  const raw = externalId.trim();
  const doi = DOI.exec(raw)?.[1].replace(/[.,;]+$/, "") ?? "";
  let arxiv = "";
  let year = 0;
  if (!doi) {
    const text = raw.replace(/^arxiv:/i, "").replace(/v\d+$/i, "");
    const fresh = NEW_ARXIV.exec(text);
    const old = fresh ? null : OLD_ARXIV.exec(text);
    const found = fresh ?? old;
    if (found) {
      arxiv = fresh ? fresh[0] : text;
      const yy = Number(found[1]);
      year = yy >= 90 ? 1900 + yy : 2000 + yy;
    }
  }
  return { arxiv, doi, year };
}

export const arxivUrl = (id: string) => `https://arxiv.org/abs/${id}`;
export const doiUrl = (doi: string) => `https://doi.org/${doi}`;

/** The authors for a card: the first few, then how many more there are. */
export function authorList(authors: string): string[] {
  return authors
    .split(/\s*(?:;|,|\band\b|\uff0c|\u3001|\uff1b)\s*/i)
    .map((name) => name.trim())
    .filter(Boolean);
}

/** The reading progress, 0 to 1, of a paper last read at `page` of `pages`. */
export function progressOf(page: number | null, pages: number | null) {
  if (!page || !pages) return 0;
  return Math.max(0, Math.min(1, page / pages));
}

export type SortKey = "opened" | "added" | "title" | "citations";

/** `papers` in the order `key` asks for; `visits` says when each was last opened on this device. */
export function sortPapers(
  papers: Paper[],
  key: SortKey,
  visits: Record<string, number>,
  locale: string,
  /** How often each paper is cited, where that is known. */
  citations: Record<string, number | null | undefined> = {},
): Paper[] {
  const list = [...papers];
  if (key === "citations") {
    // Papers with no known count go last, in the order they were opened.
    const known = (paper: Paper) => citations[paper.id] ?? -1;
    return sortPapers(list, "opened", visits, locale).sort(
      (a, b) => known(b) - known(a),
    );
  }
  if (key === "title")
    return list.sort((a, b) =>
      (a.title || "").localeCompare(b.title || "", locale, {
        sensitivity: "base",
        numeric: true,
      }),
    );
  if (key === "added")
    return list.sort((a, b) =>
      (b.created_at ?? b.updated_at).localeCompare(
        a.created_at ?? a.updated_at,
      ),
    );
  const stamp = (paper: Paper) =>
    visits[paper.id] ?? (Date.parse(paper.updated_at) || 0) / 1e6;
  // Opened here counts above everything not yet opened on this device (those fall back to their update time, scaled down).
  return list.sort((a, b) => stamp(b) - stamp(a));
}
