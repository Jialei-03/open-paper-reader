import type { Agent } from "./frames";

/**
 * The default look of each agent: a small pixel creature. Each row is one line of
 * pixels: `b` body, `d` dark, `e` eye (blinks), `a` accent, `w` light, `.` empty.
 */
export const PIXELS: Record<Agent, string[]> = {
  executor: [
    "....aaaa....",
    "...aaaaaa...",
    "..bbbbbbbb..",
    ".bbebbbbebb.",
    "bbbebbbbebbb",
    "bbbbbddbbbbb",
    ".bbbbbbbbbb.",
    "..b.b..b.b..",
    "..d.d..d.d..",
  ],
  advisor: [
    "....bbbb....",
    "..bbbbbbbb..",
    ".bddddbddddb",
    ".bdwedbdwedb",
    ".bddddbddddb",
    ".bbbbbbbbbb.",
    ".bbbbaabbbb.",
    "..bbbaabbb..",
    "...bb..bb...",
  ],
  system: [
    ".....a......",
    ".....d......",
    "..dddddddd..",
    "..dbbbbbbd..",
    "..dbebbebd..",
    "..dbbbbbbd..",
    "..dbaaaabd..",
    "..dddddddd..",
    "...d....d...",
  ],
  distiller: [
    "....bbbb....",
    "..bbbbbbbb..",
    ".bbebbbbebb.",
    ".bbbbbbbbbb.",
    ".aaaaaaaaab.",
    ".awwwawwwab.",
    ".aaaaaaaaab.",
    "..b......b..",
    "..d......d..",
  ],
};

export const COLORS: Record<
  Agent,
  { b: string; d: string; a: string; w: string }
> = {
  executor: { b: "#d9774f", d: "#5a3424", a: "#e9b949", w: "#fbefe6" },
  advisor: { b: "#53627f", d: "#232a38", a: "#c8693f", w: "#e8edf6" },
  system: { b: "#9aa0a8", d: "#3d4249", a: "#d9774f", w: "#f2f3f5" },
  distiller: { b: "#6f9a7a", d: "#2d4233", a: "#8c6a4f", w: "#f3ead9" },
};

/** What a person chose for an agent: a name and, optionally, their own picture. */
export interface Look {
  name: string;
  image: string;
}

const KEY = "ora.mascots.v1";
export const IMAGE_BYTES = 1_500_000;

/** The looks saved in this browser; storage may be unavailable, which means defaults. */
export function loadLooks(): Partial<Record<Agent, Look>> {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<Agent, Look>>) : {};
  } catch {
    return {};
  }
}

/** Saves the looks; false when this browser cannot keep them (full, private, blocked). */
export function saveLooks(looks: Partial<Record<Agent, Look>>): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(looks));
    return true;
  } catch {
    return false;
  }
}
