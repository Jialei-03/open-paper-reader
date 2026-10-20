import type { Agent, Place } from "./frames";

/** The room is drawn on a 192 × 108 pixel grid; everything else is placed on it. */
export const W = 192;
export const H = 108;

/** Where each agent stands: the centre of its feet. The squirrel sits on top of the bookshelf. */
export const STAND: Record<Agent, { x: number; y: number }> = {
  executor: { x: 57, y: 99 },
  system: { x: 112, y: 99 },
  advisor: { x: 141, y: 99 },
  distiller: { x: 171, y: 20 },
};

/** Where work lands: the whiteboard, a desk, the gate, the shelf, the door to you. */
export const SPOT: Record<Place, { x: number; y: number }> = {
  board: { x: 96, y: 27 },
  bench: { x: 24, y: 68 },
  desk: { x: 166, y: 76 },
  gate: { x: 92, y: 82 },
  shelf: { x: 172, y: 42 },
  person: { x: 49, y: 40 },
};

/** Areas the page writes into: the whiteboard, the monitor, the advisor's note, the door sign. */
export const AREA = {
  board: { x: 65, y: 9, w: 62, h: 36 },
  screen: { x: 13, y: 61, w: 22, h: 14 },
  note: { x: 151, y: 72, w: 20, h: 6 },
  door: { x: 43, y: 13, w: 12, h: 5 },
} as const;

export const pct = (x: number, y: number) => ({
  left: `${(x / W) * 100}%`,
  top: `${(y / H) * 100}%`,
});

export const areaStyle = (a: {
  x: number;
  y: number;
  w: number;
  h: number;
}) => ({
  ...pct(a.x, a.y),
  width: `${(a.w / W) * 100}%`,
  height: `${(a.h / H) * 100}%`,
});

type R = [number, number, number, number, string];

const rects: R[] = [
  // Wall, trim, wainscot and skirting.
  [0, 0, W, 62, "#efe4d2"],
  [0, 0, W, 2, "#d8c7ab"],
  [0, 52, W, 10, "#e3d3b8"],
  [0, 52, W, 1, "#cdb894"],
  [0, 60, W, 2, "#9c7a58"],
  // Floor boards.
  [0, 62, W, 46, "#c89f74"],
  ...Array.from({ length: 7 }, (_, i): R => [0, 68 + i * 6, W, 1, "#b38a62"]),
  ...Array.from(
    { length: 24 },
    (_, i): R => [
      ((i * 37) % W) + (Math.floor(i / 8) % 2) * 11,
      62 + Math.floor(i / 3) * 6,
      1,
      6,
      "#b38a62",
    ],
  ),
  // Rug in the middle.
  [62, 88, 68, 14, "#9aa9c0"],
  [64, 90, 64, 10, "#b8c4d6"],
  [64, 94, 64, 1, "#9aa9c0"],
  // Window with sky.
  [6, 8, 30, 27, "#8a6a4f"],
  [8, 10, 26, 23, "#bfe0f2"],
  [12, 14, 6, 2, "#ffffff"],
  [10, 15, 10, 2, "#ffffff"],
  [24, 24, 7, 2, "#ffffff"],
  [20, 10, 1, 23, "#8a6a4f"],
  [8, 21, 26, 1, "#8a6a4f"],
  [4, 35, 34, 2, "#a07a58"],
  // Door to you, with a sign above.
  [41, 19, 16, 43, "#7a5a40"],
  [43, 21, 12, 39, "#a8754f"],
  [45, 23, 8, 14, "#96663f"],
  [45, 40, 8, 17, "#96663f"],
  [53, 40, 1, 2, "#f2c94c"],
  [42, 12, 14, 7, "#7a5a40"],
  [43, 13, 12, 5, "#f8f4ec"],
  // Whiteboard and tray.
  [62, 6, 68, 42, "#9aa3ad"],
  [64, 8, 64, 38, "#fbfbf8"],
  [66, 48, 60, 2, "#8a929c"],
  [72, 47, 4, 1, "#d64541"],
  [78, 47, 4, 1, "#2f6bd6"],
  [84, 47, 4, 1, "#3a9a5a"],
  // Clock.
  [140, 6, 10, 10, "#3a3a3a"],
  [141, 7, 8, 8, "#f8f4ec"],
  [145, 8, 1, 4, "#3a3a3a"],
  [145, 11, 3, 1, "#3a3a3a"],
  // Bookshelf, the playbook.
  [158, 20, 30, 42, "#7a5a40"],
  [160, 22, 26, 38, "#5c4330"],
  ...[30, 40, 50].map((y): R => [160, y, 26, 2, "#7a5a40"]),
  ...[
    [161, "#c0392b"],
    [164, "#2f6b5e"],
    [167, "#e9b949"],
    [170, "#53627f"],
    [173, "#d9774f"],
    [176, "#6f9a7a"],
    [179, "#8c6a4f"],
    [182, "#c0392b"],
  ].flatMap(([x, c], i): R[] => [
    [x as number, 23 + (i % 2), 2, 7 - (i % 2), c as string],
    [
      (x as number) + (i % 3),
      32 + (i % 3 === 1 ? 1 : 0),
      2,
      8 - (i % 3 === 1 ? 1 : 0),
      c as string,
    ],
    [x as number, 43, 2, 7, c as string],
  ]),
  // Plant by the wall.
  [132, 54, 8, 8, "#b5653f"],
  [131, 53, 10, 2, "#9a5232"],
  [133, 46, 2, 7, "#4f8a4a"],
  [136, 43, 2, 10, "#5f9a5a"],
  [130, 47, 3, 2, "#5f9a5a"],
  [138, 45, 3, 2, "#4f8a4a"],
  // The executor's bench: monitor on a desk.
  [12, 60, 24, 16, "#2b2b30"],
  [13, 61, 22, 14, "#1d2b24"],
  [22, 76, 4, 2, "#2b2b30"],
  [8, 78, 38, 3, "#a8754f"],
  [8, 81, 38, 1, "#7d5434"],
  [10, 82, 2, 16, "#7d5434"],
  [42, 82, 2, 16, "#7d5434"],
  [14, 79, 12, 1, "#5a5a60"],
  // The gate: two posts and a bar.
  [84, 70, 3, 27, "#8a8f98"],
  [97, 70, 3, 27, "#8a8f98"],
  [84, 69, 3, 1, "#6b7078"],
  [97, 69, 3, 1, "#6b7078"],
  [87, 81, 10, 2, "#d64541"],
  [82, 97, 20, 2, "#6b7078"],
  // The advisor's desk: lamp and papers.
  [148, 80, 38, 3, "#a8754f"],
  [148, 83, 38, 1, "#7d5434"],
  [150, 84, 2, 14, "#7d5434"],
  [182, 84, 2, 14, "#7d5434"],
  [178, 70, 1, 10, "#3a3a3a"],
  [174, 67, 9, 3, "#2f6b5e"],
  [176, 79, 5, 1, "#3a3a3a"],
  [152, 78, 8, 2, "#ffffff"],
  [153, 77, 8, 1, "#e9e4da"],
];

/** The research room, drawn in pixels; the page lays the agents and text over it. */
export function RoomArt() {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="100%"
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      aria-hidden="true"
      style={{ position: "absolute", inset: 0 }}
    >
      {rects.map(([x, y, w, h, fill], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill={fill} />
      ))}
    </svg>
  );
}
