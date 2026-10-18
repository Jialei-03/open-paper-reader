import type { Stroke } from "../../../features/PdfInk";
import { rotatePoint } from "../../../lib/pdf-rotation";
import styles from "./layers.module.css";

export interface InkLayerProps {
  /** The paper's handwriting; the strokes of other pages are left out here. */
  strokes: Stroke[];
  page: number;
  /** The turn the reader adds to the page (always 0 in this reader). */
  rotation: number;
  /** The page's size at scale 1, in the PDF's units, as it is shown before the reader's turn. */
  size: { width: number; height: number };
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * The handwriting already on a page, drawn as it was written: each stroke a
 * path through its points (fractions of the page) with its color and its width
 * (in the PDF's units, so it thickens with the zoom). Only shown: the pointer
 * goes through it, to the text, and nothing here writes or rubs out.
 */
export function InkLayer({ strokes, page, rotation, size }: InkLayerProps) {
  const own = strokes.filter((stroke) => stroke.page === page);
  if (!own.length) return null;
  const turned = rotation % 180 !== 0;
  const width = turned ? size.height : size.width;
  const height = turned ? size.width : size.height;
  const path = (points: Stroke["data"]["points"]) =>
    points
      .map(([x, y], index) => {
        const [left, top] = rotatePoint(x, y, rotation);
        return `${index ? "L" : "M"}${round(left * width)} ${round(top * height)}`;
      })
      .join(" ") +
    // A single point is a dot: a stroke needs some length for its round cap to show.
    (points.length === 1 ? " l 0.01 0.01" : "");
  return (
    <svg
      className={styles.ink}
      viewBox={`0 0 ${round(width)} ${round(height)}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {own.map((stroke) => (
        <path
          key={stroke.id}
          data-stroke={stroke.id}
          d={path(stroke.data.points)}
          stroke={stroke.data.color}
          strokeWidth={stroke.data.width}
        />
      ))}
    </svg>
  );
}
