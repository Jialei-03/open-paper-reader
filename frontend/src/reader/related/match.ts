import type { Paper } from "../../api";

/** What names a work: any of these found in the library means it is already there. */
export interface Identity {
  doi?: string;
  arxiv?: string;
  title?: string;
}

const DOI = /(10\.\d{4,9}\/[^\s"<>]+)/i;
const ARXIV_NEW = /^\d{4}\.\d{4,5}$/;
const ARXIV_OLD = /^[a-z-]+(?:\.[A-Z]{2})?\/\d{7}$/i;

export function cleanDoi(value: string | undefined): string {
  const found = DOI.exec(value ?? "");
  return found ? found[1].replace(/[.,;)]+$/, "").toLowerCase() : "";
}

export function cleanArxiv(value: string | undefined): string {
  const text = (value ?? "")
    .trim()
    .replace(/^(arxiv:|https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/)/i, "")
    .replace(/(\.pdf)?(v\d+)?$/i, "");
  return ARXIV_NEW.test(text) || ARXIV_OLD.test(text) ? text.toLowerCase() : "";
}

const normal = (text: string | undefined) =>
  [...(text ?? "").toLowerCase()]
    .filter((c) => /[\p{L}\p{N}]/u.test(c))
    .join("");

/** The keys a work is recognised by (the same ones the server uses to leave known papers out of recommendations). */
export function keysOf(work: Identity): string[] {
  const keys: string[] = [];
  const doi = cleanDoi(work.doi);
  const arxiv = cleanArxiv(work.arxiv);
  if (doi) keys.push("doi:" + doi);
  if (arxiv) keys.push("arxiv:" + arxiv, "doi:10.48550/arxiv." + arxiv);
  const title = normal(work.title);
  if (title.length >= 12) keys.push("title:" + title.slice(0, 200));
  return keys;
}

/** What the library holds, by key, to the paper's id. `records` are the public records found for papers (DOI, arXiv id). */
export function libraryIndex(
  papers: Paper[],
  records: Record<string, Identity | undefined> = {},
): Map<string, string> {
  const index = new Map<string, string>();
  for (const paper of papers) {
    const record = records[paper.id];
    const doi = cleanDoi(paper.external_id);
    const arxiv = doi ? "" : cleanArxiv(paper.external_id);
    for (const key of keysOf({
      doi: doi || record?.doi,
      arxiv: arxiv || record?.arxiv,
      title: paper.title,
    }))
      if (!index.has(key)) index.set(key, paper.id);
  }
  return index;
}

/** The library paper that is this work, if any. */
export function inLibrary(
  index: Map<string, string>,
  work: Identity,
): string | undefined {
  for (const key of keysOf(work)) {
    const id = index.get(key);
    if (id) return id;
  }
  return undefined;
}
