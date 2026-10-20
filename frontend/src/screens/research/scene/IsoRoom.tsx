import { useEffect, useRef } from "react";
import type { Agent, Place } from "./frames";

/**
 * The research room seen from above at an angle (2:1 isometric), painted pixel by
 * pixel on a 320 × 200 canvas that the page scales up without smoothing, so every
 * slope stays a pixel staircase. World units: x runs along the right wall, y along
 * the left wall, z up; the far corner of the floor is (0, 0, 0).
 *
 * The room is symmetric about its middle (x = y): the beaver's workstation on the
 * left, the owl's mirrored on the right, the boss's raised desk at the back between
 * them, the rug in the middle.
 */
export const LW = 320;
export const LH = 200;
const OY = 78;

export const project = (x: number, y: number, z = 0) => ({
  x: 160 + (x - y),
  y: OY + (x + y) / 2 - z,
});

/** The boss's dais: how high it lifts the boss's desk and chair. */
const DAIS = 7;

/**
 * Where each agent sits, and where it goes on an errand: the beaver and the owl take
 * their notes to each other's desk; the boss comes down to the beaver's desk to stop
 * it. `perched` figures sit on something low (the squirrel's armchair), so their legs
 * are hidden; a desk hides the others' by itself.
 */
interface Seat {
  at: [number, number, number];
  errand?: [number, number, number];
  perched: boolean;
}
const SEATS: Record<Agent, Seat> = {
  executor: { at: [35, 63, 4], errand: [80, 54, 0], perched: false },
  advisor: { at: [63, 35, 4], errand: [54, 80, 0], perched: false },
  system: { at: [24, 24, DAIS + 4], errand: [52, 80, 0], perched: false },
  distiller: { at: [107, 26, 8], perched: true },
};

export interface Figure {
  /** The point under the visible figure, on the screen. */
  x: number;
  y: number;
  /** Its distance from the back corner: larger is nearer, drawn in front. */
  depth: number;
  perched: boolean;
}

/** Where `agent` is: at its seat, or away on its errand. */
export function figure(agent: Agent, away: boolean): Figure {
  const seat = SEATS[agent];
  const errand = away ? seat.errand : undefined;
  const [x, y, z] = errand ?? seat.at;
  return {
    ...project(x, y, z),
    depth: project(x, y, 0).y,
    perched: seat.perched && !errand,
  };
}

/** Where work lands. `gate` is the boss's desk (the system's place). */
export const SPOT: Record<Place, { x: number; y: number }> = {
  board: project(45, 0, 45),
  bench: project(27, 77, 22),
  desk: project(77, 27, 22),
  gate: project(37, 37, DAIS + 18),
  shelf: project(104, 12, 30),
  person: project(0, 81, 25),
};

/** Text areas on the walls and the monitor: a corner, a size, and the wall's slant. */
export interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
  /** +1 for planes along x (right wall, faces turned left), -1 for planes along y. */
  slant: 1 | -1;
}

const along = (
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  slant: 1 | -1,
): Area => ({ ...project(x, y, z), w, h, slant });

export const AREA = {
  board: along(20, 0, 64, 50, 38, 1),
  screen: along(28, 81, 28, 8, 10, -1),
  note: along(69, 44, 20, 16, 6, 1),
  door: along(0, 90, 59, 17, 5, -1),
} as const;

export const pct = (x: number, y: number) => ({
  left: `${(x / LW) * 100}%`,
  top: `${(y / LH) * 100}%`,
});

/** Lays text into an area so it slants with the wall it is on. */
export const areaStyle = (a: Area) => ({
  ...pct(a.x, a.y),
  width: `${(a.w / LW) * 100}%`,
  height: `${(a.h / LH) * 100}%`,
  transform: `skewY(${a.slant * 26.565}deg)`,
  transformOrigin: "0 0",
});

type Pt = { x: number; y: number };
type Paint = (points: Pt[], color: string) => void;

/** Fills a polygon with whole pixels: no smoothing, so edges stay crisp steps. */
function filler(data: Uint8ClampedArray): Paint {
  return (points, color) => {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    const ys = points.map((p) => p.y);
    const top = Math.max(0, Math.floor(Math.min(...ys)));
    const bottom = Math.min(LH - 1, Math.ceil(Math.max(...ys)));
    for (let py = top; py <= bottom; py++) {
      const cy = py + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const c = points[(i + 1) % points.length];
        if ((a.y <= cy && c.y > cy) || (c.y <= cy && a.y > cy))
          xs.push(a.x + ((cy - a.y) / (c.y - a.y)) * (c.x - a.x));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = Math.max(0, Math.ceil(xs[k] - 0.5));
        const to = Math.min(LW - 1, Math.floor(xs[k + 1] - 0.5));
        for (let px = from; px <= to; px++) {
          const at = (py * LW + px) * 4;
          data[at] = r;
          data[at + 1] = g;
          data[at + 2] = b;
          data[at + 3] = 255;
        }
      }
    }
  };
}

const quad = (...corners: [number, number, number][]) =>
  corners.map(([x, y, z]) => project(x, y, z));

/** A rectangle on the plane y = y0 (the right wall, or a face turned to the left). */
const onY = (y0: number, x0: number, x1: number, z0: number, z1: number) =>
  quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
/** A rectangle on the plane x = x0 (the left wall, or a face turned to the right). */
const onX = (x0: number, y0: number, y1: number, z0: number, z1: number) =>
  quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]);
const flat = (x0: number, x1: number, y0: number, y1: number, z: number) =>
  quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]);

/** A solid box: its top and the two faces turned to the viewer. */
function box(
  paint: Paint,
  [x0, x1, y0, y1, z0, z1]: number[],
  [top, left, right]: string[],
) {
  paint(onY(y1, x0, x1, z0, z1), left);
  paint(onX(x1, y0, y1, z0, z1), right);
  paint(flat(x0, x1, y0, y1, z1), top);
}

const WOOD = ["#b5835b", "#a8754f", "#8d5f3d"];
const DARK = ["#3a3a40", "#2b2b30", "#202024"];
const BLUE = ["#3f5f8a", "#2f4f7a", "#24406a"];
const POLE = ["#4a4a50", "#3a3a40", "#2a2a30"];

/** An office chair with its back on the far side along x (`backAlongX`) or along y. */
function chair(
  paint: Paint,
  cx: number,
  cy: number,
  z: number,
  backAlongX: boolean,
  colors = BLUE,
) {
  box(paint, [cx - 1, cx + 1, cy - 1, cy + 1, z, z + 6], POLE);
  box(paint, [cx - 6, cx + 6, cy - 5, cy + 5, z + 6, z + 8], colors);
  if (backAlongX)
    box(paint, [cx - 7, cx - 5, cy - 6, cy + 6, z + 8, z + 25], colors);
  else box(paint, [cx - 6, cx + 6, cy - 7, cy - 5, z + 8, z + 25], colors);
}

/** The walls, floor and everything that stands behind the agents. */
function paintBack(paint: Paint) {
  // Walls: the left one in shade, the right one in light, with a skirting board.
  paint(onX(0, 0, 120, 0, 75), "#e3d6c0");
  paint(onY(0, 0, 120, 0, 75), "#efe4d2");
  paint(onX(0, 0, 120, 0, 6), "#b89a76");
  paint(onY(0, 0, 120, 0, 6), "#c9ab86");
  paint(onX(0, 0, 120, 72, 75), "#cdbc9f");
  paint(onY(0, 0, 120, 72, 75), "#dccbb0");
  // Floor: wooden tiles in two tones.
  for (let i = 0; i < 10; i++)
    for (let j = 0; j < 10; j++)
      paint(
        flat(i * 12, i * 12 + 12, j * 12, j * 12 + 12, 0),
        (i + j) % 2 ? "#c89f74" : "#bf946a",
      );
  // Rug in the middle of the room.
  paint(flat(52, 92, 52, 92, 0), "#8f9fbb");
  paint(flat(55, 89, 55, 89, 0), "#b8c4d6");
  // Left wall: window, the door to you with its sign, and a plant by the front.
  paint(onX(0, 12, 46, 28, 62), "#8a6a4f");
  paint(onX(0, 14, 44, 30, 60), "#bfe0f2");
  paint(onX(0, 28, 30, 30, 60), "#8a6a4f");
  paint(onX(0, 14, 44, 44, 46), "#8a6a4f");
  paint(onX(0, 18, 26, 52, 55), "#ffffff");
  paint(onX(0, 32, 40, 36, 38), "#ffffff");
  paint(onX(0, 70, 92, 0, 52), "#7a5a40");
  paint(onX(0, 72, 90, 0, 50), "#a8754f");
  paint(onX(0, 74, 88, 28, 46), "#96663f");
  paint(onX(0, 74, 88, 4, 24), "#96663f");
  paint(onX(0, 73, 75, 24, 26), "#f2c94c");
  paint(onX(0, 72, 90, 53, 60), "#7a5a40");
  paint(onX(0, 73, 89, 54, 59), "#f8f4ec");
  box(paint, [3, 11, 100, 108, 0, 9], ["#9a5232", "#b5653f", "#a35a37"]);
  box(paint, [4, 10, 101, 107, 9, 22], ["#6faa5f", "#5f9a5a", "#4f8a4a"]);
  box(paint, [5, 9, 102, 106, 22, 27], ["#7fba6f", "#6faa5f", "#5f9a5a"]);
  // Right wall: whiteboard with its tray, and a clock.
  paint(onY(0, 18, 72, 22, 66), "#9aa3ad");
  paint(onY(0, 20, 70, 24, 64), "#fbfbf8");
  box(paint, [22, 68, 0, 3, 21, 22], ["#8a929c", "#7a828c", "#6b7078"]);
  paint(onY(1, 28, 32, 22, 23), "#d64541");
  paint(onY(1, 34, 38, 22, 23), "#2f6bd6");
  paint(onY(1, 40, 44, 22, 23), "#3a9a5a");
  paint(onY(0, 82, 92, 58, 68), "#3a3a3a");
  paint(onY(0, 83, 91, 59, 67), "#f8f4ec");
  paint(onY(0, 86, 87, 63, 66), "#3a3a3a");
  paint(onY(0, 86, 89, 63, 64), "#3a3a3a");
  // Bookshelf against the right wall: the playbook.
  box(paint, [92, 118, 0, 12, 0, 56], ["#8a6a4f", "#7a5a40", "#6a4c36"]);
  paint(onY(12, 94, 116, 3, 53), "#4a3526");
  const books = [
    "#c0392b",
    "#2f6b5e",
    "#e9b949",
    "#53627f",
    "#d9774f",
    "#6f9a7a",
    "#8c6a4f",
  ];
  for (const [shelf, z] of [
    [0, 4],
    [1, 21],
    [2, 38],
  ] as const)
    for (let k = 0; k < 10; k++) {
      const x = 95 + k * 2.1;
      paint(
        onY(12, x, x + 1.6, z, z + 13 - ((k + shelf) % 3) * 2),
        books[(k + shelf * 3) % books.length],
      );
    }
  paint(onY(12, 94, 116, 18, 20), "#7a5a40");
  paint(onY(12, 94, 116, 35, 37), "#7a5a40");
  // The boss's dais in the back corner, with a step and a high-backed red chair.
  box(paint, [12, 52, 12, 52, 0, DAIS], ["#9c7652", "#8a6545", "#76563a"]);
  box(paint, [20, 44, 52, 56, 0, 3], ["#9c7652", "#8a6545", "#76563a"]);
  const RED = ["#c0504a", "#a5403a", "#8a332e"];
  box(paint, [23, 25, 23, 25, DAIS, DAIS + 6], POLE);
  box(paint, [17, 30, 17, 30, DAIS + 6, DAIS + 8], RED);
  box(paint, [15, 18, 15, 30, DAIS + 8, DAIS + 30], RED);
  box(paint, [15, 30, 15, 18, DAIS + 8, DAIS + 30], RED);
  // The two workstation chairs, mirrored: the beaver's back to the right wall,
  // the owl's back to the left wall.
  chair(paint, 35, 61, 0, false);
  chair(paint, 61, 35, 0, true);
  // The squirrel's armchair by the bookshelf.
  const GREEN = ["#8aaa7a", "#7a9a6a", "#6a8a5a"];
  box(paint, [100, 114, 18, 21, 0, 20], ["#7a9a6a", "#6a8a5a", "#5a7a4a"]);
  box(paint, [100, 114, 21, 30, 0, 8], GREEN);
  box(paint, [100, 102, 21, 30, 8, 13], GREEN);
  box(paint, [112, 114, 21, 30, 8, 13], GREEN);
}

/** The beaver's workstation on the left: a desk, a monitor at its far end, a keyboard. */
function paintBench(paint: Paint) {
  box(paint, [26, 44, 68, 86, 0, 14], WOOD);
  box(paint, [26, 30, 75, 79, 14, 16], DARK);
  box(paint, [26, 28, 72, 82, 16, 29], DARK);
  paint(onX(28, 73, 81, 17, 28), "#1d2b24");
  box(paint, [31, 39, 70, 74, 14, 15], ["#6a6a72", "#5a5a60", "#4a4a50"]);
}

/** The owl's workstation on the right, mirrored: a desk, a lamp at its far end, papers. */
function paintDesk(paint: Paint) {
  box(paint, [68, 86, 26, 44, 0, 14], WOOD);
  box(paint, [76, 78, 27, 29, 14, 26], ["#4a4a4a", "#3a3a3a", "#2a2a2a"]);
  box(paint, [73, 81, 26, 31, 26, 30], ["#3f8a7a", "#2f6b5e", "#24564b"]);
  box(paint, [70, 74, 31, 39, 14, 15], ["#ffffff", "#e9e4da", "#dcd6ca"]);
}

/** The boss's desk on the dais, square to the middle of the room, with a nameplate. */
function paintBoss(paint: Paint) {
  box(
    paint,
    [28, 46, 28, 46, DAIS, DAIS + 14],
    ["#6b4a33", "#5a3d2a", "#4a3222"],
  );
  box(
    paint,
    [36, 44, 42, 44, DAIS + 14, DAIS + 17],
    ["#f2c94c", "#d9b13a", "#b8952e"],
  );
  box(
    paint,
    [30, 36, 30, 36, DAIS + 14, DAIS + 15],
    ["#ffffff", "#e9e4da", "#dcd6ca"],
  );
}

/**
 * The room in layers, back to front. Each desk is its own layer at its front corner's
 * depth, so an agent sitting behind a desk is hidden by it.
 */
const LAYERS: { key: string; depth: number; paint: (paint: Paint) => void }[] =
  [
    { key: "back", depth: 0, paint: paintBack },
    { key: "boss", depth: project(46, 46).y, paint: paintBoss },
    { key: "bench", depth: project(44, 86).y, paint: paintBench },
    { key: "desk", depth: project(86, 44).y, paint: paintDesk },
  ];

function Layer({
  depth,
  paint,
}: {
  depth: number;
  paint: (paint: Paint) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    const image = context.createImageData(LW, LH);
    paint(filler(image.data));
    context.putImageData(image, 0, 0);
  }, [paint]);
  return (
    <canvas
      ref={canvas}
      width={LW}
      height={LH}
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: depth ? 2 + Math.round(depth) : 0,
        width: "100%",
        height: "100%",
        imageRendering: "pixelated",
        pointerEvents: "none",
      }}
    />
  );
}

/** The room itself, in layers; the page lays the agents and the text among them. */
export function IsoRoomArt() {
  return (
    <>
      {LAYERS.map((layer) => (
        <Layer key={layer.key} depth={layer.depth} paint={layer.paint} />
      ))}
    </>
  );
}
