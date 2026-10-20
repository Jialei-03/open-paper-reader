import type { Agent } from "./frames";

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
