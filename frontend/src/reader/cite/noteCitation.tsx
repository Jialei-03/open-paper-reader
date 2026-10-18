import { Node, type JSONContent } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { useEffect, useState } from "react";
import { CiteChip, useCiteTarget } from "./CiteChip";
import {
  copiedCite,
  leadingMark,
  markKey,
  writeMark,
  type CiteMark,
} from "./marks";
import { peek, useVerdict } from "./verify";

const markOf = (node: ProseMirrorNode): CiteMark => ({
  page: Number(node.attrs.page),
  quote: String(node.attrs.quote ?? ""),
});

/**
 * A sentence citation in a note: stored as its marker, `[[p3: "…"]]`, in the
 * note's Markdown, drawn as the same numbered chip as in the guide and the
 * answers. It is drawn only once the service has found its words on the page
 * (the editor asks about the note's markers); until then, and when they are not
 * found, it takes no room on screen — and stays in the text.
 */
function CitationView({ node, editor, getPos }: NodeViewProps) {
  const target = useCiteTarget();
  const mark = markOf(node);
  const verdict = useVerdict(target?.fileId, mark);
  const [, redraw] = useState(0);
  // The numbers follow the note's text, which changes around the chip.
  useEffect(() => {
    const again = () => redraw((count) => count + 1);
    editor.on("transaction", again);
    return () => void editor.off("transaction", again);
  }, [editor]);
  if (!target || !verdict) return <NodeViewWrapper as="span" hidden />;
  const at = getPos() ?? 0;
  const seen = new Set<string>();
  editor.state.doc.nodesBetween(0, at, (child) => {
    if (child.type.name !== "citation") return;
    const found = peek(target.fileId, markOf(child));
    if (found) seen.add(markKey(found));
  });
  const key = markKey(verdict);
  const n = seen.has(key) ? [...seen].indexOf(key) + 1 : seen.size + 1;
  return (
    <NodeViewWrapper as="span" contentEditable={false} data-citation="">
      <CiteChip n={n} mark={verdict} inNote />
    </NodeViewWrapper>
  );
}

export const NoteCitation = Node.create({
  name: "citation",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      page: { default: 1 },
      quote: { default: "" },
    };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-citation]",
        getAttrs: (element) => ({
          page: Number(element.getAttribute("data-page")) || 1,
          quote: element.getAttribute("data-quote") ?? "",
        }),
      },
    ];
  },
  renderHTML({ node }) {
    return [
      "span",
      {
        "data-citation": "",
        "data-page": String(node.attrs.page),
        "data-quote": String(node.attrs.quote),
      },
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CitationView, { as: "span" });
  },
  markdownTokenizer: {
    name: "citation",
    level: "inline",
    start: (src: string) => src.indexOf("[["),
    tokenize: (src: string) => {
      const found = leadingMark(src);
      return found
        ? { type: "citation", raw: found.raw, mark: found.mark }
        : undefined;
    },
  },
  parseMarkdown: (token): JSONContent => {
    const { mark } = token as unknown as { mark: CiteMark };
    return { type: "citation", attrs: { page: mark.page, quote: mark.quote } };
  },
  renderMarkdown: (node: JSONContent) =>
    writeMark({
      page: Number(node.attrs?.page) || 1,
      quote: String(node.attrs?.quote ?? ""),
    }) ?? "",
});

/** What copying text with citations in it leaves as plain text: "(p. 3)" where each is. */
export const noteLeafText = (leaf: ProseMirrorNode) =>
  leaf.type.name === "citation"
    ? copiedCite(Number(leaf.attrs.page))
    : leaf.type.name === "inlineMath" || leaf.type.name === "blockMath"
      ? `$${leaf.attrs.latex ?? ""}$`
      : "";
