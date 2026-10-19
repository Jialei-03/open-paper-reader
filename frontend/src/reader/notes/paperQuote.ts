import { useEffect, useRef } from "react";
import { writeMark } from "../cite/marks";
import { readerHash } from "../route";

/** Words selected on a page of the paper. */
export interface PaperQuote {
  page: number;
  text: string;
}

/** The page of the paper a node is on, if it is on one (`[data-page]`, the PDF's pages). */
function pageOf(node: Node | null): number | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const sheet = element?.closest<HTMLElement>("[data-page]");
  // Not the note's own text, which can sit in a panel beside the pages.
  if (!sheet || element?.closest("[contenteditable=true]")) return null;
  const page = Number(sheet.dataset.page);
  return Number.isInteger(page) && page > 0 ? page : null;
}

/** The page of the paper in the middle of its view, if a paper is shown. */
export function shownPage(): number | null {
  let best: number | null = null;
  let most = 0;
  for (const sheet of document.querySelectorAll<HTMLElement>("[data-page]")) {
    const page = Number(sheet.dataset.page);
    if (!Number.isInteger(page) || page < 1) continue;
    const box = sheet.getBoundingClientRect();
    const seen =
      Math.max(0, Math.min(box.bottom, innerHeight) - Math.max(box.top, 0)) *
      Math.max(0, Math.min(box.right, innerWidth) - Math.max(box.left, 0));
    if (seen > most) {
      most = seen;
      best = page;
    }
  }
  return best;
}

/**
 * The words last selected in the paper, kept after the selection is gone (the
 * reader clicks into the note to put them there, which clears it). A new
 * selection in the paper replaces them.
 */
export function usePaperQuote(): () => PaperQuote | null {
  const last = useRef<PaperQuote | null>(null);
  useEffect(() => {
    const read = () => {
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed) return;
      const page = pageOf(selection.anchorNode);
      if (page === null || pageOf(selection.focusNode) !== page) return;
      const text = selection.toString().replace(/\s+/g, " ").trim();
      if (text) last.current = { page, text };
    };
    document.addEventListener("selectionchange", read);
    return () => document.removeEventListener("selectionchange", read);
  }, []);
  return () => last.current;
}

/**
 * The paper's words as the note keeps them: quoted, with the citation that
 * leads back to the sentence (a link to its page and words when they are too
 * long for a citation).
 */
export function quoteMarkdown(
  quote: PaperQuote,
  paper: { paperId: string; fileId: string },
  source: string,
): string {
  const text = quote.text.replace(/\s+/g, " ").trim();
  const mark = writeMark({ page: quote.page, quote: text });
  const back =
    mark ??
    `[${source.replace(/[[\]]/g, "")}](${readerHash({
      ...paper,
      page: quote.page,
      quote: text.slice(0, 200),
    })})`;
  return `> ${text.replace(/([\\`*_[\]<>#])/g, "\\$1")} ${back}\n\n`;
}

/** A link to a page of the paper, as the note keeps it. */
export function pageMarkdown(
  page: number,
  paper: { paperId: string; fileId: string },
  source: string,
): string {
  return `[${source.replace(/[[\]]/g, "")}](${readerHash({ ...paper, page })}) `;
}
