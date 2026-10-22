import { parseAppRoute, type AppRoute } from "./routes";

export type LocalSection =
  | "research"
  | "materials"
  | "tasks"
  | "customize"
  | "board";

export function localSection(route: AppRoute): LocalSection {
  switch (route.screen) {
    case "home":
    case "library":
    case "discover":
    case "reader":
    case "open":
      return "materials";
    case "research-tasks":
      return "tasks";
    case "customize":
      return "customize";
    case "research-board":
      return "board";
    default:
      return "research";
  }
}

/** Remember only app addresses that really belong to their section. */
export function validSectionAddress(
  section: LocalSection,
  hash: unknown,
): hash is string {
  if (typeof hash !== "string" || hash.length > 2048) return false;
  const route = parseAppRoute(hash);
  return (
    !route.redirect &&
    route.screen !== "settings" &&
    route.screen !== "open" &&
    !new URLSearchParams(hash.split("?")[1] || "").has("import") &&
    localSection(route) === section
  );
}

export function readSectionAddresses(
  owner: string,
): Partial<Record<LocalSection, string>> {
  try {
    const saved = JSON.parse(
      localStorage.getItem(`app-sections:${owner}`) || "{}",
    );
    if (!saved || typeof saved !== "object") return {};
    return Object.fromEntries(
      (
        [
          "research",
          "materials",
          "tasks",
          "customize",
          "board",
        ] as LocalSection[]
      )
        .filter((section) => validSectionAddress(section, saved[section]))
        .map((section) => [section, saved[section]]),
    );
  } catch {
    return {};
  }
}
