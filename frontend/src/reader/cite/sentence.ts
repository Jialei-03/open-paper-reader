import { copiedCite } from "./marks";

/** The name of the highlight that marks the sentence a citation belongs to. */
export const SENTENCE_HIGHLIGHT = "opr-cite-sentence";

const END = /[\u3002\uff01\uff1f!?\uff1b;]|\.(?=\s|$)/g;

/**
 * The sentence a citation chip closes: the text before it back to the end of
 * the sentence before, within the same block and after any earlier chip.
 */
export function sentenceRange(chip: HTMLElement): Range | null {
  const block = chip.closest(
    "p, li, td, th, blockquote, h1, h2, h3, h4, h5, h6, div",
  );
  if (!block) return null;
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.parentElement?.closest("[data-cite-chip]")) {
      // A chip (this one or an earlier one) ends what came before it.
      if (chip.contains(node)) break;
      nodes.length = 0;
      continue;
    }
    if (chip.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)
      break;
    nodes.push(node);
  }
  const text = nodes.map((node) => node.data).join("");
  const trimmed = text.replace(/\s+$/, "");
  if (!trimmed) return null;
  // The sentence's own full stop is its end, not the boundary before it.
  const body = trimmed.slice(0, -1);
  let start = 0;
  for (const found of body.matchAll(END)) start = found.index + found[0].length;
  while (start < trimmed.length && /\s/.test(trimmed[start])) start += 1;
  if (start >= trimmed.length) return null;
  const locate = (offset: number, atEnd: boolean) => {
    let seen = 0;
    for (const node of nodes) {
      if (
        offset < seen + node.length ||
        (atEnd && offset <= seen + node.length)
      )
        return { node, offset: offset - seen };
      seen += node.length;
    }
    return null;
  };
  const from = locate(start, false);
  const to = locate(trimmed.length, true);
  if (!from || !to) return null;
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

type Highlights = {
  set(name: string, value: unknown): void;
  delete(name: string): void;
};
const registry = (): Highlights | null =>
  (globalThis.CSS as unknown as { highlights?: Highlights } | undefined)
    ?.highlights ?? null;

/** Marks the sentence of `chip`; the returned function takes the mark away. */
export function markSentence(chip: HTMLElement): () => void {
  const highlights = registry();
  const Highlight = (
    globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }
  ).Highlight;
  const range = sentenceRange(chip);
  if (!highlights || !Highlight || !range) return () => {};
  highlights.set(SENTENCE_HIGHLIGHT, new Highlight(range));
  return () => highlights.delete(SENTENCE_HIGHLIGHT);
}

/**
 * A copy of text that holds citation chips leaves "(p. 3)" where each chip is,
 * in the plain text and in the HTML, instead of the chip's number.
 */
export function copyWithCitations(event: {
  clipboardData: DataTransfer | null;
  preventDefault(): void;
}) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !event.clipboardData) return;
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < selection.rangeCount; index++)
    fragment.append(selection.getRangeAt(index).cloneContents());
  const chips = fragment.querySelectorAll<HTMLElement>("[data-cite-chip]");
  if (!chips.length) return;
  chips.forEach((chip) =>
    chip.replaceWith(copiedCite(Number(chip.dataset.citePage))),
  );
  const holder = document.createElement("div");
  holder.style.cssText =
    "position:fixed;left:-9999px;top:0;white-space:pre-wrap;";
  holder.append(fragment);
  document.body.append(holder);
  const plain = holder.innerText;
  const html = holder.innerHTML;
  holder.remove();
  event.clipboardData.setData("text/plain", plain);
  event.clipboardData.setData("text/html", html);
  event.preventDefault();
}
