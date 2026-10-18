import { api } from "../../api";

/** What the service knows of a cited work (`backend/citations.py`'s `lookup`). */
export interface CitedWork {
  title: string;
  authors: string[];
  year: number | null;
  venue: string;
  abstract: string;
  citation_count: number | null;
  reference_count: number | null;
  doi: string;
  arxiv: string;
  url: string;
}

/** The work an entry of the reference list names, or `null` when no service knows it. */
export async function lookupCitation(
  entry: string,
  signal?: AbortSignal,
): Promise<CitedWork | null> {
  const answer = await api<{ item: CitedWork | null }>(
    `/citations/lookup?entry=${encodeURIComponent(entry)}`,
    { signal },
  );
  return answer.item?.title ? answer.item : null;
}

/** The PDF of an arXiv paper, through the service (the browser cannot read arXiv itself). */
export const arxivPdfUrl = (arxiv: string) =>
  `/api/v1/citations/arxiv-pdf?id=${encodeURIComponent(arxiv)}`;

/** An address worth offering as a link: the web only. */
export function webUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}

export const arxivAddress = (arxiv: string) =>
  `https://arxiv.org/abs/${encodeURIComponent(arxiv)}`;
export const doiAddress = (doi: string) =>
  `https://doi.org/${doi.split("/").map(encodeURIComponent).join("/")}`;

/** "Vaswani, Shazeer, Parmar et al. · NeurIPS · 2017", from what is known. */
export function byline(
  work: Pick<CitedWork, "authors" | "venue" | "year">,
  etAl: (authors: string) => string,
  shown = 3,
): string {
  const names =
    work.authors.length > shown
      ? etAl(work.authors.slice(0, shown).join(", "))
      : work.authors.join(", ");
  return [names, work.venue, work.year].filter(Boolean).join(" · ");
}
