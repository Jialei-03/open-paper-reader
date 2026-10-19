import type { ResearchNode } from "./research-api";

export type TreeNode = ResearchNode & { children: TreeNode[] };

/**
 * The research map as a tree: each node under its parent, siblings oldest
 * first. A node whose parent is not in the list hangs under the root, so
 * nothing the agent wrote is lost from view.
 */
export function buildTree(nodes: ResearchNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>(
    nodes.map((node) => [node.id, { ...node, children: [] }]),
  );
  const roots: TreeNode[] = [];
  const orphans: TreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parent_id === null) roots.push(node);
    else {
      const parent = byId.get(node.parent_id);
      if (parent) parent.children.push(node);
      else orphans.push(node);
    }
  }
  if (roots.length) roots[0].children.push(...orphans);
  else roots.push(...orphans);
  const sort = (list: TreeNode[]) => {
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    list.forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}
