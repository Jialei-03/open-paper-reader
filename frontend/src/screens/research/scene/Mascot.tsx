import { COLORS, PIXELS, type Look } from "./mascots";
import type { Agent } from "./frames";
import styles from "./scene.module.css";

/** An agent's figure: the person's own picture when they gave one, else its pixel creature. */
export function Mascot({
  agent,
  look,
  size = 64,
}: {
  agent: Agent;
  look?: Look;
  size?: number;
}) {
  if (look?.image)
    return (
      <img
        className={styles.mascotImage}
        src={look.image}
        alt=""
        width={size}
        height={size}
        draggable={false}
      />
    );
  const rows = PIXELS[agent];
  const colors = COLORS[agent];
  const width = Math.max(...rows.map((row) => row.length));
  return (
    <svg
      className={styles.mascotPixels}
      viewBox={`0 0 ${width} ${rows.length}`}
      width={size}
      height={(size * rows.length) / width}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {rows.flatMap((row, y) =>
        [...row].map((cell, x) => {
          if (cell === ".") return null;
          const fill =
            cell === "e" ? colors.d : colors[cell as "b" | "d" | "a" | "w"];
          return (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width={1}
              height={1}
              fill={fill}
              className={cell === "e" ? styles.eye : undefined}
            />
          );
        }),
      )}
    </svg>
  );
}
