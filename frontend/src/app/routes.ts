import {
  parseReaderRoute,
  readerHash,
  type ReaderRoute,
} from "../reader/route";

/**
 * Where the signed-in app is: one of its screens, or a paper in the reader.
 * `redirect` is set when the address was not this one's own (an old address,
 * or one that names nothing): the app replaces it with `redirect` so the back
 * button does not lead to it again.
 */
export type AppRoute =
  | { screen: "home"; redirect?: string }
  | { screen: "library"; redirect?: string }
  | { screen: "discover"; redirect?: string }
  | { screen: "settings"; redirect?: string }
  | { screen: "research"; projectId?: string; redirect?: string }
  | { screen: "open"; url: string; redirect?: string }
  | { screen: "reader"; reader: ReaderRoute; redirect?: string };

/** The screens the shell draws itself; the reader draws its own. */
export type AppScreen = AppRoute["screen"];

const HOME: AppRoute = { screen: "home" };

/**
 * Reads the hash, without its `#`. `#paper/<id>` is the old reader's address:
 * it opens the new reader, with the same `file`, `page`, `quote`, `prefix` and
 * `rect`, and is rewritten to `#read/<id>…`. Anything else that is not one of
 * the screens (the addresses of what has been taken out: knowledge,
 * directions, collections, tokens…) goes home.
 */
export function parseAppRoute(hash: string): AppRoute {
  const path = hash.split("?")[0];
  if (path === "" || path === "home") return HOME;
  if (path === "library") return { screen: "library" };
  if (path === "discover") return { screen: "discover" };
  if (path === "settings") return { screen: "settings" };
  if (path === "research") return { screen: "research" };
  if (path.startsWith("research/")) {
    const projectId = path.slice("research/".length);
    return /^[0-9a-f-]{36}$/.test(projectId)
      ? { screen: "research", projectId }
      : { screen: "research", redirect: "research" };
  }
  if (path === "open") {
    // From the browser extension: the address of a paper to import, then read.
    const url = new URLSearchParams(hash.split("?")[1] ?? "").get("url") ?? "";
    return /^https?:\/\/\S+$/i.test(url.trim())
      ? { screen: "open", url: url.trim() }
      : { ...HOME, redirect: "home" };
  }
  if (path.startsWith("read/")) {
    const reader = parseReaderRoute(hash);
    return reader
      ? { screen: "reader", reader }
      : { ...HOME, redirect: "home" };
  }
  if (path.startsWith("paper/")) {
    const reader = parseReaderRoute("read/" + hash.slice("paper/".length));
    if (!reader) return { ...HOME, redirect: "home" };
    // Only what the reader reads is carried over (an old `note=` or `line=` is not).
    return {
      screen: "reader",
      reader,
      redirect: readerHash(reader).slice(1),
    };
  }
  return { ...HOME, redirect: "home" };
}
