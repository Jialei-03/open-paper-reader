import { FRESH } from "./smooth";

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/**
 * A rehype plugin that wraps the last few characters of the revealed text in a
 * span (`data-fresh`), which the style fades out toward the edge: the text
 * seems to come in out of the dark rather than to blink onto the page. Code
 * and formulas are left whole.
 */
export function fadeTail() {
  return (tree: HastNode) => {
    const find = (node: HastNode, skip: boolean): [HastNode, number] | null => {
      const children = node.children;
      if (!children) return null;
      const inert =
        skip ||
        node.tagName === "code" ||
        node.tagName === "pre" ||
        (Array.isArray(node.properties?.className) &&
          (node.properties.className as string[]).some((name) =>
            String(name).startsWith("katex"),
          ));
      for (let i = children.length - 1; i >= 0; i -= 1) {
        const child = children[i];
        if (child.type === "text" && child.value?.trim() && !inert)
          return [node, i];
        const deeper = find(child, inert);
        if (deeper) return deeper;
        // Anything not text (a formula, code) ends the tail: the fade belongs to plain words.
        if (child.type === "element" && !child.children?.length) return null;
      }
      return null;
    };
    const hit = find(tree, false);
    if (!hit) return;
    const [parent, index] = hit;
    const node = parent.children![index];
    const value = node.value!;
    const chars = Array.from(value);
    const cut = Math.max(0, chars.length - FRESH);
    const head = chars.slice(0, cut).join("");
    const tail = chars.slice(cut).join("");
    parent.children!.splice(
      index,
      1,
      ...(head ? [{ type: "text", value: head }] : []),
      {
        type: "element",
        tagName: "span",
        properties: { dataFresh: "" },
        children: [{ type: "text", value: tail }],
      },
    );
  };
}
