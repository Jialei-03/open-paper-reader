import { hasCjk, parseName, type CiteRecord } from "./types";

/** Characters BibTeX would read as markup, written so they print as themselves. */
export function escapeBibtex(text: string) {
  return text
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

const ascii = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase();

const SKIP = new Set(["a", "an", "the", "on", "of", "in", "for", "to", "and"]);

/** `vaswani2017attention`; Chinese names and titles fall back to what is left of them in ASCII, else `paper`. */
export function bibtexKey(record: CiteRecord) {
  const first = record.authors[0] ? parseName(record.authors[0]) : null;
  const family = first && !hasCjk(first.family) ? ascii(first.family) : "";
  const word =
    record.title
      .split(/\s+/)
      .map(ascii)
      .find((part) => part && !SKIP.has(part)) ?? "";
  return (
    `${family}${record.year ?? ""}${word}` ||
    (record.arxiv ? "arxiv" + ascii(record.arxiv) : "paper")
  );
}

function field(name: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "";
  const text = typeof value === "number" ? String(value) : escapeBibtex(value);
  return `  ${name} = {${text}},\n`;
}

export function formatBibtex(record: CiteRecord, key = bibtexKey(record)) {
  const { kind, venue } = record;
  const type =
    kind === "journal"
      ? "article"
      : kind === "conference"
        ? "inproceedings"
        : "misc";
  const authors = record.authors
    .map((raw) => {
      const name = parseName(raw);
      return name.whole || !name.given
        ? `{${escapeBibtex(name.family)}}`
        : `${escapeBibtex(name.family)}, ${escapeBibtex(name.given)}`;
    })
    .join(" and ");
  let body = "";
  // The extra braces keep the title's capitals as they are written.
  body += field("title", record.title).replace(/\{(.*)\}/, "{{$1}}");
  body += authors ? `  author = {${authors}},\n` : "";
  if (type === "article") body += field("journal", venue);
  if (type === "inproceedings") body += field("booktitle", venue);
  body += field("year", record.year);
  body += field("volume", record.volume);
  body += field("number", record.issue);
  body += field("pages", record.pages.replace(/\s*[-–—]+\s*/, "--"));
  body += field("doi", record.doi.replace(/\\/g, ""));
  if (record.arxiv) {
    body += field("eprint", record.arxiv);
    body += "  archivePrefix = {arXiv},\n";
  }
  body += field("url", record.url);
  return `@${type}{${key},\n${body.replace(/,\n$/, "\n")}}`;
}

/** Entries for several papers, with keys that do not repeat. */
export function formatBibtexFile(records: CiteRecord[]) {
  const used = new Map<string, number>();
  return (
    records
      .map((record) => {
        const base = bibtexKey(record);
        const count = used.get(base) ?? 0;
        used.set(base, count + 1);
        const key = count ? base + String.fromCharCode(96 + count) : base;
        return formatBibtex(record, key);
      })
      .join("\n\n") + "\n"
  );
}
