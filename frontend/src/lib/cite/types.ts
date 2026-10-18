import type { Paper } from "../../api";
import { authorList, paperIds } from "../../screens/library/paper-meta";

/** What the public record says about a paper; the shape the service stores. */
export interface PaperMetadata {
  paper_id: string;
  /** `none`: never looked up; `missing`: looked up and not found. */
  status: "ok" | "missing" | "none";
  fetched_at?: string;
  title?: string;
  authors?: string[];
  year?: number | null;
  venue?: string;
  abstract?: string;
  citation_count?: number | null;
  reference_count?: number | null;
  doi?: string;
  arxiv?: string;
  url?: string;
  kind?: "journal" | "conference" | "preprint" | "";
  volume?: string;
  issue?: string;
  pages?: string;
  source?: string;
}

export type CiteKind = "journal" | "conference" | "preprint" | "other";

/** Everything a reference needs, gathered from the paper and its public record. */
export interface CiteRecord {
  title: string;
  authors: string[];
  year: number | null;
  venue: string;
  kind: CiteKind;
  volume: string;
  issue: string;
  pages: string;
  doi: string;
  arxiv: string;
  url: string;
}

export type CiteFormat = "bibtex" | "apa" | "gbt";

/** The paper as the library holds it, filled in from the public record where the paper itself is silent. */
export function citeRecord(
  paper: Paper,
  meta?: PaperMetadata | null,
): CiteRecord {
  const known = meta?.status === "ok" ? meta : null;
  const ids = paperIds(paper.external_id);
  const doi = ids.doi || known?.doi || "";
  const arxiv = ids.arxiv || known?.arxiv || "";
  const venue = (known?.venue ?? "").trim();
  let kind: CiteKind = known?.kind || "other";
  if (kind === "other" && venue) kind = "journal";
  if (kind === "other" && arxiv) kind = "preprint";
  const own = authorList(paper.authors);
  return {
    title: (paper.title || known?.title || "").trim(),
    authors: own.length ? own : (known?.authors ?? []),
    year: known?.year || ids.year || null,
    venue,
    kind,
    volume: known?.volume ?? "",
    issue: known?.issue ?? "",
    pages: known?.pages ?? "",
    doi,
    arxiv,
    url: arxiv ? `https://arxiv.org/abs/${arxiv}` : (known?.url ?? ""),
  };
}

export const hasCjk = (text: string) => /[㐀-鿿]/.test(text);

export interface Name {
  family: string;
  /** Given names, separated by spaces, as written. */
  given: string;
  /** A name written in Chinese, or any that has no family/given order to split. */
  whole: boolean;
}

/** "Ashish Vaswani" and "Vaswani, Ashish" alike. */
export function parseName(raw: string): Name {
  const name = raw.replace(/\s+/g, " ").trim();
  if (hasCjk(name)) return { family: name, given: "", whole: true };
  if (name.includes(",")) {
    const [family, ...rest] = name.split(",");
    return {
      family: family.trim(),
      given: rest.join(" ").trim(),
      whole: false,
    };
  }
  const parts = name.split(" ");
  if (parts.length === 1) return { family: name, given: "", whole: true };
  return {
    family: parts[parts.length - 1],
    given: parts.slice(0, -1).join(" "),
    whole: false,
  };
}

/** The initials of the given names: "Jean-Paul" gives J and P, "E." gives E. */
export function initials(given: string): string[] {
  return given
    .split(/[\s-]+/)
    .map((part) => part.replace(/[.]/g, ""))
    .filter(Boolean)
    .map((part) => Array.from(part)[0].toUpperCase());
}

/** A page range with `dash` between its ends: GB/T writes a hyphen, APA an en dash. */
export function pageRange(pages: string, dash = "-") {
  return pages.replace(/\s*[-\u2013\u2014]+\s*/, dash);
}
