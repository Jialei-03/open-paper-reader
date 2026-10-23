export type ResearchGrouping = "workspace" | "collection";
export interface TreeGroupPreference {
  open: string[];
  expanded: string[];
}
export interface ResearchTreePreferences {
  mode: ResearchGrouping;
  workspace?: TreeGroupPreference;
  collection?: TreeGroupPreference;
}

const storageKey = (owner: string) => `research-navigation:${owner}`;
const defaults = (): ResearchTreePreferences => ({ mode: "workspace" });
export function rememberedTreeWorkspace(owner: string): string | undefined {
  if (!owner) return undefined;
  try {
    return localStorage.getItem(`research-workspace:${owner}`) || undefined;
  } catch {
    return undefined;
  }
}
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const groupPreference = (value: unknown): TreeGroupPreference | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const group = value as Record<string, unknown>;
  return strings(group.open) && strings(group.expanded)
    ? { open: [...new Set(group.open)], expanded: [...new Set(group.expanded)] }
    : undefined;
};

export function readTreePreferences(
  owner: string,
  storage?: Pick<Storage, "getItem">,
): ResearchTreePreferences {
  if (!owner) return defaults();
  try {
    const value: unknown = JSON.parse(
      (storage || localStorage).getItem(storageKey(owner)) || "null",
    );
    if (!value || typeof value !== "object") return defaults();
    const saved = value as Record<string, unknown>;
    return {
      mode: saved.mode === "collection" ? "collection" : "workspace",
      workspace: groupPreference(saved.workspace),
      collection: groupPreference(saved.collection),
    };
  } catch {
    return defaults();
  }
}

export function writeTreePreferences(
  owner: string,
  preferences: ResearchTreePreferences,
  storage?: Pick<Storage, "setItem">,
) {
  if (!owner) return;
  try {
    (storage || localStorage).setItem(
      storageKey(owner),
      JSON.stringify(preferences),
    );
  } catch {
    // Navigation still works when optional local preferences are unavailable.
  }
}

/** A fresh grouping opens one useful folder. Saved manual folds survive reloads. */
export function focusTreeGroup(
  preferences: ResearchTreePreferences,
  mode: ResearchGrouping,
  focusedId: string | undefined,
  fallbackId: string,
  selectionChanged: boolean,
): ResearchTreePreferences {
  const group = preferences[mode];
  if (!group)
    return {
      ...preferences,
      [mode]: { open: [focusedId || fallbackId], expanded: [] },
    };
  if (!selectionChanged || !focusedId || group.open.includes(focusedId))
    return preferences;
  return {
    ...preferences,
    [mode]: { ...group, open: [...group.open, focusedId] },
  };
}

/** Keep the selected research in a short list without changing the pin order. */
export function visibleTreeRows<T extends { id: string }>(
  rows: T[],
  currentId: string | undefined,
  expanded: boolean,
  limit = 5,
): T[] {
  if (expanded || rows.length <= limit) return rows;
  const current = rows.find((row) => row.id === currentId);
  const first = rows.slice(0, limit);
  if (!current || first.includes(current)) return first;
  return [...rows.slice(0, limit - 1), current];
}
