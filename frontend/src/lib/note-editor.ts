import { Markdown } from "@tiptap/markdown";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { NoteBlockMath, NoteInlineMath, safeMathOptions } from "./note-math";
import { safeNoteImage } from "./note-images";

/**
 * What a note's editor is made of, for every editor of a note (the old reader's
 * and the new one's): Markdown in and out, tables, task lists, formulas and
 * images. It sets up no interface.
 */

/** What an image of the note is called where it is drawn, in the interface's language. */
export interface NoteImageLabels {
  /** The name of an image that has none of its own. */
  alt: string;
  /** What stands in place of an image that is not drawn, from its name (empty when it has none). */
  missing(alt: string): string;
}

/** An image whose address is not one of the note's own is not drawn. */
export const SafeImage = Image.extend<{ labels: NoteImageLabels }>({
  addOptions() {
    return {
      ...this.parent?.(),
      labels: { alt: "", missing: (alt: string) => alt },
    };
  },
  renderHTML({ node }) {
    const { labels } = this.options;
    if (safeNoteImage(node.attrs.src))
      return [
        "img",
        {
          src: node.attrs.src,
          alt: node.attrs.alt || labels.alt,
          title: node.attrs.title,
          loading: "lazy",
        },
      ];
    return [
      "span",
      { "data-image-placeholder": "" },
      labels.missing(node.attrs.alt || ""),
    ];
  },
});

/** A formula that was clicked: where it is in the document, and what it says. */
export interface FormulaClick {
  pos: number;
  latex: string;
  block: boolean;
}

export function noteExtensions(
  onFormula: (formula: FormulaClick) => void,
  imageLabels: NoteImageLabels,
) {
  const clicked = (block: boolean) => (node: ProseMirrorNode, pos: number) =>
    onFormula({ pos, latex: node.attrs.latex, block });
  return [
    StarterKit.configure({
      link: {
        openOnClick: false,
        HTMLAttributes: { target: null, rel: "noopener noreferrer" },
      },
      underline: false,
    }),
    Markdown.configure({ markedOptions: { gfm: true } }),
    NoteBlockMath.configure({
      katexOptions: safeMathOptions,
      onClick: clicked(true),
    }),
    NoteInlineMath.configure({
      katexOptions: safeMathOptions,
      onClick: clicked(false),
    }),
    TableKit,
    TaskList,
    TaskItem.configure({
      nested: true,
      HTMLAttributes: { "data-type": "taskItem" },
    }),
    SafeImage.configure({ labels: imageLabels }),
  ];
}
