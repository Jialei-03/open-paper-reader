import { owningPaper } from "./organization";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Item, Paper } from "../api";

export type KnowledgeNode = {
  id: string;
  title: string;
  kind: string;
  body: string;
  route: string;
  parent?: string | null;
};
export type KnowledgeEdge = { source: string; target: string; label: string };
export type KnowledgeGraph = { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] };
const parser = unified().use(remarkParse);
export function contentLinks(body: string): string[] {
  const ids = new Set<string>();
  const tree = parser.parse(body);
  const definitions = new Map<string, string>();
  const walk = (node: any, fn: (node: any) => void) => {
    fn(node);
    node.children?.forEach((child: any) => walk(child, fn));
  };
  walk(tree, (node) => {
    if (node.type === "definition") definitions.set(node.identifier, node.url);
  });
  walk(tree, (node) => {
    const url =
      node.type === "link"
        ? node.url
        : node.type === "linkReference"
          ? definitions.get(node.identifier)
          : undefined;
    const match = url?.match(/^#(paper|item)\/([a-zA-Z0-9-]+)(?:\?.*)?$/);
    if (match) ids.add(`${match[1]}/${match[2]}`);
  });
  return [...ids];
}
export function buildKnowledge(papers: Paper[], items: Item[]): KnowledgeGraph {
  const nodes = [
    ...papers.map((p) => ({
      id: `paper/${p.id}`,
      route: `paper/${p.id}`,
      title: p.title,
      kind: "paper",
      body: p.abstract,
    })),
    ...items.map((i) => ({
      id: `item/${i.id}`,
      route: `item/${i.id}`,
      title: i.title || i.body.slice(0, 60) || "未命名记录",
      kind: i.kind,
      parent: owningPaper(i) ? `paper/${owningPaper(i)}` : null,
      body: i.body,
    })),
  ];
  const available = new Set(nodes.map((n) => n.id));
  const edges: KnowledgeEdge[] = [];
  const seen = new Set<string>();
  const add = (source: string, target: string, label: string) => {
    const key = `${source}:${target}:${label}`;
    if (source === target || !available.has(target) || seen.has(key)) return;
    seen.add(key);
    edges.push({ source, target, label });
  };
  for (const i of items) {
    const source = `item/${i.id}`;
    if (i.paper_id) add(source, `paper/${i.paper_id}`, "所属论文");
    i.paper_ids.forEach((id) => add(source, `paper/${id}`, "关联论文"));
    i.evidence_ids.forEach((id) => add(source, `item/${id}`, "引用证据"));
  }
  nodes.forEach((n) =>
    contentLinks(n.body).forEach((id) => add(n.id, id, "正文链接")),
  );
  return { nodes, edges };
}
export function linkMarkdown(node: KnowledgeNode) {
  return `[${node.title.replace(/[\\[\]]/g, "\\$&").replace(/\s+/g, " ")}](#${node.route})`;
}
