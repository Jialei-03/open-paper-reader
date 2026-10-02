import type { Item } from "../api";

// Single-paper Agent output belongs inside that paper, including legacy topics.
export function owningPaper(
  item: Pick<Item, "paper_id" | "paper_ids" | "attribution">,
) {
  return (
    item.paper_id ||
    (item.attribution?.startsWith("agent:") && item.paper_ids?.length === 1
      ? item.paper_ids[0]
      : null)
  );
}
export const isIndependent = (item: Item) => !owningPaper(item);
