import {
  hasCjk,
  initials,
  pageRange,
  parseName,
  type CiteRecord,
} from "./types";

/**
 * GB/T 7714-2015 (numbered-reference style).
 *
 *   journal      Authors. Title[J]. Journal, Year, Vol(Issue): Pages. DOI.
 *   conference   Authors. Title[C]//Proceedings. Year: Pages. DOI.
 *   preprint     Authors. Title[EB/OL]. (Year)[Accessed]. URL.
 *
 * Authors: at most three, then ", et al" (", 等" for Chinese); a western name is
 * the family name in capitals and the initials without stops ("VASWANI A").
 */
const MAX_AUTHORS = 3;

function author(raw: string) {
  const name = parseName(raw);
  if (name.whole) return name.family;
  const marks = initials(name.given).join(" ");
  return `${name.family.toUpperCase()}${marks ? " " + marks : ""}`;
}

export function gbtAuthors(authors: string[], chinese: boolean) {
  const shown = authors.slice(0, MAX_AUTHORS).map(author).join(", ");
  if (authors.length <= MAX_AUTHORS) return shown;
  return `${shown}, ${chinese ? "等" : "et al"}`;
}

const dateText = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

/** `today` is the date of access, for sources read online. */
export function formatGbt(record: CiteRecord, today = new Date()): string {
  const { title, kind, year, venue, volume, issue, pages, doi, arxiv } = record;
  const chinese = hasCjk(title) || record.authors.some(hasCjk);
  const who = gbtAuthors(record.authors, chinese);
  const head = who ? `${who}. ` : "";
  const range = pages ? pageRange(pages) : "";
  const doiPart = doi ? ` DOI:${doi}.` : "";
  if (kind === "preprint" || (kind === "other" && arxiv)) {
    const url = record.url || (arxiv ? `https://arxiv.org/abs/${arxiv}` : "");
    const posted = year ? ` (${year})` : "";
    return (
      `${head}${title}[EB/OL].${posted}[${dateText(today)}]. ` +
      (url ? `${url}.` : arxiv ? `arXiv:${arxiv}.` : "")
    ).trim();
  }
  const when = year ? String(year) : "";
  if (kind === "conference") {
    const place = [venue, when].filter(Boolean).join(", ");
    const where = range ? `${place}: ${range}` : place;
    return `${head}${title}[C]//${where}.${doiPart}`;
  }
  if (kind === "journal") {
    const number = volume ? `${volume}${issue ? `(${issue})` : ""}` : "";
    const tail = number
      ? `, ${number}${range ? `: ${range}` : ""}`
      : range
        ? `: ${range}`
        : "";
    const where = [venue, when].filter(Boolean).join(", ");
    return `${head}${title}[J]. ${where}${tail}.${doiPart}`;
  }
  // No venue and no arXiv id: a plain document.
  const online = record.url || (doi ? `https://doi.org/${doi}` : "");
  return `${head}${title}[Z].${year ? ` ${year}.` : ""}${online ? ` ${online}.` : ""}`.trim();
}
