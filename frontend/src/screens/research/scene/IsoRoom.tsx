import { useEffect, useRef } from "react";
import type { Agent, Place } from "./frames";

/**
 * The research room seen from above at an angle (2:1 isometric), painted pixel by
 * pixel on a 320 × 200 canvas that the page scales up without smoothing, so every
 * slope stays a pixel staircase. World units: x runs along the right wall, y along
 * the left wall, z up; the far corner of the floor is (0, 0, 0).
 */
export const LW = 320;
export const LH = 200;
const OY = 78;

export const project = (x: number, y: number, z = 0) => ({
  x: 160 + (x - y),
  y: OY + (x + y) / 2 - z,
});

/**
 * Where each agent sits, and where it goes when it gets up. The beaver and the owl
 * sit on office chairs behind their desks, facing the room; the shiba keeps a stool
 * on the rug and walks over to the beaver's desk to stop it; the squirrel reads in an
 * armchair by the bookshelf. `perched` figures sit on top of something low (a stool,
 * an armchair), so their legs are hidden; a desk hides the others' by itself.
 */
interface Seat {
  at: [number, number, number];
  perched: boolean;
}
const SEATS: Record<Agent, Seat> = {
  executor: { at: [33, 47, 4], perched: false },
  advisor: { at: [97, 43, 4], perched: false },
  system: { at: [72, 86, 8], perched: true },
  distiller: { at: [107, 26, 8], perched: true },
};
/** The shiba on duty: in front of the beaver's desk, to stop it. */
const ON_DUTY: [number, number, number] = [54, 78, 0];

export interface Figure {
  /** The point under the visible figure, on the screen. */
  x: number;
  y: number;
  /** Its distance from the back corner: larger is nearer, drawn in front. */
  depth: number;
  perched: boolean;
}

/** Where `agent` is: sitting, unless it is on its feet. */
export function figure(agent: Agent, standing: boolean): Figure {
  const seat = SEATS[agent];
  const [x, y, z] = standing && agent === "system" ? ON_DUTY : seat.at;
  return {
    ...project(x, y, z),
    depth: project(x, y, 0).y,
    perched: seat.perched && !(standing && agent === "system"),
  };
}

/** Where work lands. */
export const SPOT: Record<Place, { x: number; y: number }> = {
  board: project(45, 0, 45),
  bench: project(18, 62, 22),
  desk: project(90, 58, 15),
  gate: project(72, 86, 10),
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
): Area => ({
  ...project(x, y, z),
  w,
  h,
  slant,
});

export const AREA = {
  board: along(20, 0, 64, 50, 38, 1),
  screen: along(18, 67, 27, 10, 10, -1),
  note: along(98, 66, 20, 16, 6, 1),
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

/** A rectangle on the right wall (the plane y = y0) or a box face facing +y. */
const onY = (y0: number, x0: number, x1: number, z0: number, z1: number) =>
  quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
/** A rectangle on the left wall (the plane x = x0) or a box face facing +x. */
const onX = (x0: number, y0: number, y1: number, z0: number, z1: number) =>
  quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]);
const flat = (x0: number, x1: number, y0: number, y1: number, z: number) =>
  quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]);

/** A solid box: its top and the two faces turned to the viewer, with a darker edge. */
function box(
  paint: Paint,
  [x0, x1, y0, y1, z0, z1]: number[],
  [top, left, right]: string[],
) {
  paint(onY(y1, x0, x1, z0, z1), left);
  paint(onX(x1, y0, y1, z0, z1), right);
  paint(flat(x0, x1, y0, y1, z1), top);
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
  // Rug.
  paint(flat(34, 82, 40, 96, 0), "#8f9fbb");
  paint(flat(37, 79, 43, 93, 0), "#b8c4d6");
  // Left wall: window, and the door to you with its sign.
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
  // Plant in the corner by the right wall.
  box(paint, [74, 82, 3, 11, 0, 9], ["#9a5232", "#b5653f", "#a35a37"]);
  box(paint, [75, 81, 4, 10, 9, 22], ["#6faa5f", "#5f9a5a", "#4f8a4a"]);
  box(paint, [76, 80, 5, 9, 22, 27], ["#7fba6f", "#6faa5f", "#5f9a5a"]);
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
  // Office chairs behind the two desks, facing the room.
  for (const [x0, y0] of [
    [26, 40],
    [90, 36],
  ]) {
    box(
      paint,
      [x0 + 6, x0 + 8, y0 + 4, y0 + 6, 0, 6],
      ["#4a4a50", "#3a3a40", "#2a2a30"],
    );
    box(
      paint,
      [x0 + 1, x0 + 13, y0 + 1, y0 + 9, 6, 8],
      ["#3f5f8a", "#2f4f7a", "#24406a"],
    );
    box(
      paint,
      [x0 + 1, x0 + 13, y0, y0 + 2, 8, 25],
      ["#3f5f8a", "#2f4f7a", "#24406a"],
    );
  }
  // The squirrel's armchair by the bookshelf.
  box(paint, [100, 114, 18, 21, 0, 20], ["#7a9a6a", "#6a8a5a", "#5a7a4a"]);
  box(paint, [100, 114, 21, 30, 0, 8], ["#8aaa7a", "#7a9a6a", "#6a8a5a"]);
  box(paint, [100, 102, 21, 30, 8, 13], ["#8aaa7a", "#7a9a6a", "#6a8a5a"]);
  box(paint, [112, 114, 21, 30, 8, 13], ["#8aaa7a", "#7a9a6a", "#6a8a5a"]);
}

/** The executor's desk, its monitor turned sideways so the beaver can be seen. */
function paintBench(paint: Paint) {
  box(paint, [14, 48, 54, 70, 0, 14], ["#b5835b", "#a8754f", "#8d5f3d"]);
  box(paint, [15, 20, 60, 64, 14, 16], ["#3a3a40", "#2b2b30", "#202024"]);
  box(paint, [16, 18, 56, 68, 16, 29], ["#3a3a40", "#2b2b30", "#202024"]);
  paint(onX(18, 57, 67, 17, 28), "#1d2b24");
  box(paint, [28, 40, 56, 60, 14, 15], ["#6a6a72", "#5a5a60", "#4a4a50"]);
}

/** The shiba's stool, on the rug in the middle of the room. */
function paintStool(paint: Paint) {
  box(paint, [71, 73, 85, 87, 0, 6], ["#6b7078", "#5b6068", "#4b5058"]);
  box(paint, [68, 76, 82, 90, 6, 8], ["#d64541", "#b5362f", "#9a2e28"]);
}

/** The advisor's desk: a lamp at the far end, papers at the front, the owl's face clear. */
function paintDesk(paint: Paint) {
  box(paint, [80, 112, 50, 66, 0, 14], ["#b5835b", "#a8754f", "#8d5f3d"]);
  box(paint, [100, 110, 58, 65, 14, 15], ["#ffffff", "#e9e4da", "#dcd6ca"]);
  box(paint, [82, 84, 52, 54, 14, 26], ["#4a4a4a", "#3a3a3a", "#2a2a2a"]);
  box(paint, [79, 87, 50, 56, 26, 30], ["#3f8a7a", "#2f6b5e", "#24564b"]);
}

/**
 * The room in layers, back to front. Each piece of furniture is its own layer at its
 * front corner's depth, so an agent sitting behind a desk is hidden by it.
 */
const LAYERS: { key: string; depth: number; paint: (paint: Paint) => void }[] =
  [
    { key: "back", depth: 0, paint: paintBack },
    { key: "bench", depth: project(48, 70).y, paint: paintBench },
    { key: "desk", depth: project(112, 66).y, paint: paintDesk },
    // Under the shiba: just behind the point it sits on.
    { key: "stool", depth: project(72, 86).y - 1, paint: paintStool },
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
