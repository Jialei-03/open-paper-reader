import { initials, pageRange, parseName, type CiteRecord } from "./types";

/**
 * APA 7th edition, as plain text (no italics: it is pasted into anything).
 *
 *   Family, A. B., Family, C., & Family, D. (Year). Title. Venue, Vol(Issue), Pages. https://doi.org/…
 */
function author(raw: string) {
  const name = parseName(raw);
  if (name.whole) return name.family;
  const marks = initials(name.given)
    .map((letter) => `${letter}.`)
    .join(" ");
  return marks ? `${name.family}, ${marks}` : name.family;
}

export function apaAuthors(authors: string[]) {
  const names = authors.map(author);
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]}, & ${names[1]}`;
  // Twenty or fewer are all named; longer lists give 19, an ellipsis and the last.
  if (names.length <= 20)
    return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
  return `${names.slice(0, 19).join(", ")}, … ${names[names.length - 1]}`;
}

const ended = (text: string) => (/[.?!]$/.test(text) ? text : text + ".");

export function formatApa(record: CiteRecord): string {
  const { title, kind, year, venue, volume, issue, pages, doi, arxiv } = record;
  const who = apaAuthors(record.authors);
  const when = `(${year ?? "n.d."})`;
  const head = who ? `${ended(who)} ${when}. ` : `${when}. `;
  const link = doi
    ? `https://doi.org/${doi}`
    : arxiv
      ? `https://arxiv.org/abs/${arxiv}`
      : record.url;
  const tail = link ? ` ${link}` : "";
  const range = pages ? pageRange(pages, "\u2013") : "";
  if (kind === "preprint" || (kind === "other" && arxiv))
    return `${head}${ended(title)} arXiv${arxiv ? `:${arxiv}` : ""}.${tail}`.trim();
  if (kind === "conference") {
    const inside = [venue ? `In ${venue}` : "", range ? `(pp. ${range})` : ""]
      .filter(Boolean)
      .join(" ");
    return `${head}${ended(title)}${inside ? " " + ended(inside) : ""}${tail}`.trim();
  }
  if (kind === "journal") {
    const number = volume ? `${volume}${issue ? `(${issue})` : ""}` : "";
    const source = [venue, number, range].filter(Boolean).join(", ");
    return `${head}${ended(title)}${source ? " " + ended(source) : ""}${tail}`.trim();
  }
  return `${head}${ended(title)}${tail}`.trim();
}
