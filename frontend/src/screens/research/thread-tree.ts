import type { NavigationResearch } from "./navigation-api";

export function threadTree(rows: NavigationResearch[]) {
  const sorted = [...rows].sort((a, b) =>
    (b.updated_at ?? "").localeCompare(a.updated_at ?? ""),
  );
  const ids = new Set(rows.map((r) => r.id));
  const seen = new Set<string>();
  const result: { research: NavigationResearch; depth: number }[] = [];
  const visit = (research: NavigationResearch, depth: number) => {
    if (seen.has(research.id)) return;
    seen.add(research.id);
    result.push({ research, depth });
    sorted
      .filter((r) => r.parent_id === research.id)
      .forEach((r) => visit(r, depth + 1));
  };
  sorted
    .filter((r) => !r.parent_id || !ids.has(r.parent_id))
    .forEach((r) => visit(r, 0));
  sorted.forEach((r) => visit(r, 0));
  return result;
}
