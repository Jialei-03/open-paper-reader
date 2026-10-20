import type { Agent } from "./frames";
import type { Pose } from "./pose";

/**
 * The four animals, 16 × 16 pixels each: the beaver builds (executor), the owl
 * judges (advisor), the shiba keeps the gate (system), the squirrel stores what
 * was learned (distiller). Each has a base picture; a pose changes a few pixels,
 * in one or two frames that alternate. A pixel is `x,y,colour key`; `.` clears it.
 */
export interface Sprite {
  palette: Record<string, string>;
  base: string[];
  poses: Partial<Record<Pose, string[][]>>;
}

const span = (y: number, from: number, to: number, c: string) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${from + i},${y},${c}`);
const box = (x0: number, y0: number, x1: number, y1: number, c: string) =>
  Array.from({ length: y1 - y0 + 1 }, (_, i) => span(y0 + i, x0, x1, c)).flat();

/** A sheet of paper held in front of the body. */
const paper = (x: number, y: number) => [
  ...box(x, y, x + 3, y + 2, "p"),
  ...span(y + 1, x, x + 2, "q"),
];

export const SPRITES: Record<Agent, Sprite> = {
  executor: {
    palette: {
      d: "#3a2618",
      b: "#a0693f",
      l: "#e0bf98",
      k: "#1a1410",
      w: "#ffffff",
      n: "#2a1a10",
      y: "#f2c94c",
      Y: "#c99a2e",
      t: "#5c3b22",
      g: "#9aa0a8",
      h: "#8a5a33",
      p: "#ffffff",
      q: "#b9c2cc",
      r: "#d64541",
    },
    base: [
      "................",
      ".....yyyyyy.....",
      "....yyyyyyyy....",
      "...YYYYYYYYYY...",
      "....dbbbbbbd....",
      "...dbbbbbbbbd...",
      "...dbkbbbbkbd...",
      "...dbbbnnbbbd...",
      "...dbblwwlbbd...",
      "....dbbwwbbd....",
      "...dbbllllbbd...",
      "..dbbllllllbbd..",
      "..dbbllllllbbdtt",
      "..dbbllllllbbdtt",
      "...dbbbbbbbbd.tt",
      "...dd......dd...",
    ],
    poses: {
      idle: [[], ["5,6,b", "10,6,b"]],
      // A hammer, up then down.
      work: [
        ["0,6,g", "1,6,g", "2,6,g", "1,7,h", "1,8,h", "1,9,h", "2,10,b"],
        ["0,10,g", "1,10,g", "2,10,g", "1,11,h", "1,12,h", "1,13,h"],
      ],
      talk: [["7,9,k", "8,9,k"], []],
      carry: [paper(6, 11)],
      startled: [
        ["13,0,r", "13,1,r", "13,3,r", "7,9,k", "8,9,k", "5,6,w", "10,6,w"],
        ["7,9,k", "8,9,k", "5,6,w", "10,6,w"],
      ],
    },
  },
  advisor: {
    palette: {
      d: "#2b2a33",
      b: "#6b7a99",
      l: "#c9cfdd",
      w: "#f4f1ea",
      k: "#1d1d22",
      g: "#b08a3e",
      a: "#e08a3c",
      c: "#8a5a33",
      p: "#ffffff",
      q: "#b9c2cc",
      r: "#c0392b",
      s: "#5a3a24",
    },
    base: [
      "................",
      "...d........d...",
      "...dd......dd...",
      "...dbbbbbbbbd...",
      "..dbbbbbbbbbbd..",
      "..dggggbbggggd..",
      "..dgwkgbbgwkgd..",
      "..dggggaaggggd..",
      "..dbbbbaabbbbd..",
      "..dbllllllllbd..",
      "..dbllllllllbd..",
      ".dbbllllllllbbd.",
      ".dbbllllllllbbd.",
      "..dbbllllllbbd..",
      "...dbbbbbbbbd...",
      "....aa....aa....",
    ],
    poses: {
      idle: [[], ["4,6,g", "5,6,g", "10,6,g", "11,6,g"]],
      // Writing on a clipboard; the pencil moves down the page.
      work: [
        [
          ...box(13, 8, 15, 13, "c"),
          ...box(14, 9, 14, 12, "p"),
          "14,10,q",
          "12,9,k",
          "12,10,s",
        ],
        [
          ...box(13, 8, 15, 13, "c"),
          ...box(14, 9, 14, 12, "p"),
          "14,10,q",
          "12,11,k",
          "12,12,s",
        ],
      ],
      talk: [["7,8,k"], []],
      carry: [paper(6, 11)],
      // The verdict stamp, raised and then pressed.
      stamp: [
        ["14,2,s", "14,3,s", "13,4,r", "14,4,r", "15,4,r"],
        [
          "14,9,s",
          "14,10,s",
          "13,11,r",
          "14,11,r",
          "15,11,r",
          "13,12,r",
          "15,12,r",
        ],
      ],
    },
  },
  system: {
    palette: {
      d: "#3b2a20",
      o: "#d98a4e",
      c: "#f5e6cf",
      k: "#1a1410",
      n: "#2a1d16",
      u: "#2f3e5c",
      U: "#1f2a40",
      y: "#f2c94c",
      r: "#d64541",
      w: "#ffffff",
    },
    base: [
      "................",
      "....uuuuuuuu....",
      "...uuuuyuuuuu...",
      ".doUUUUUUUUUUod.",
      ".dooooooooooood.",
      ".dookoooooookod.",
      ".dcccooooooccd..",
      "..dccccnnccccd..",
      "...dcccccccccd..",
      "....dooooooood..",
      "...doooyyooood..",
      "..dooocccccoood.",
      "..dooocccccoood.",
      "...doooooooood..",
      "...dod.....dod..",
      "...dd......dd...",
    ],
    poses: {
      idle: [[], ["4,5,o", "11,5,o"]],
      talk: [["7,8,k", "8,8,k"], []],
      // A paw up with the stop sign, waved.
      stop: [
        [
          ...box(12, 1, 15, 4, "r"),
          ...span(2, 13, 14, "w"),
          "14,6,o",
          "14,7,o",
          "14,8,o",
        ],
        [
          ...box(12, 2, 15, 5, "r"),
          ...span(3, 13, 14, "w"),
          "14,7,o",
          "14,8,o",
          "7,8,k",
          "8,8,k",
        ],
      ],
    },
  },
  distiller: {
    palette: {
      d: "#3a2c22",
      b: "#8c6f5a",
      l: "#e6d3bd",
      t: "#b08a6c",
      T: "#8c6a4f",
      k: "#1a1410",
      n: "#3a2c22",
      a: "#4f7a5c",
      w: "#f3ead9",
      q: "#c9bba5",
      o: "#c98b4a",
      O: "#7a5230",
    },
    base: [
      "...........ttt..",
      "..........ttttt.",
      "...dd....tttTtt.",
      "..dbbd...ttT..t.",
      "..dbbbbd..tt....",
      ".dbbbbbbd..tt...",
      ".dbkbbkbd...tt..",
      ".dbbbnbbd...tt..",
      ".dllbbbld..tt...",
      "..dllllld.tt....",
      "..dbaaaaaatt....",
      "..dbawwqwa......",
      "..dbawqwwa......",
      "..dbaaaaaa......",
      "...dbbbbd.......",
      "...dd..dd.......",
    ],
    poses: {
      idle: [[], ["3,6,b", "6,6,b"]],
      // Turning the pages of the playbook.
      work: [[], ["6,11,w", "7,11,q", "5,12,q", "6,12,w", "8,12,q"]],
      talk: [["5,8,k"], []],
      carry: [["9,5,O", "10,5,O", "9,6,o", "10,6,o", "9,7,o", "10,7,o"]],
    },
  },
};

/** The pixels of `agent` in `pose`: one grid per frame. A missing pose falls back to talking. */
export function framesOf(agent: Agent, pose: Pose): string[][] {
  const sprite = SPRITES[agent];
  const patches = sprite.poses[pose] ?? sprite.poses.talk ?? [[]];
  return patches.map((patch) => {
    const grid = sprite.base.map((row) => [...row.padEnd(16, ".")]);
    for (const pixel of patch) {
      const [x, y, c] = pixel.split(",");
      const row = grid[Number(y)];
      if (row && Number(x) >= 0 && Number(x) < 16) row[Number(x)] = c;
    }
    return grid.map((row) => row.join(""));
  });
}
