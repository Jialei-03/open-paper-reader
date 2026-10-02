import { InputRule } from "@tiptap/core";
import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";

// Match the Markdown delimiters in both typed input and stored documents.
export const NoteBlockMath = BlockMath.extend({
  addInputRules() {
    return [
      new InputRule({
        find: /^\$\$([^$]+)\$\$$/,
        handler: ({ state, range, match }) => {
          const from = state.doc.resolve(range.from);
          if (!from.parent.isTextblock) return null;
          state.tr.replaceWith(
            from.before(),
            from.after(),
            this.type.create({ latex: match[1].trim() }),
          );
        },
      }),
    ];
  },
});
export const NoteInlineMath = InlineMath.extend({
  addInputRules() {
    return [
      new InputRule({
        find: /(?<![$\\])\$([^$\n]+)\$$/,
        handler: ({ state, range, match }) => {
          state.tr.replaceWith(
            range.from,
            range.to,
            this.type.create({ latex: match[1].trim() }),
          );
        },
      }),
    ];
  },
});
export const safeMathOptions = {
  trust: false,
  throwOnError: false,
  maxExpand: 1000,
  maxSize: 20,
};
