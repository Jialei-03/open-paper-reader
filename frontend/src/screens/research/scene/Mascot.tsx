import type { Agent } from "./frames";
import type { Look } from "./mascots";
import type { Pose } from "./pose";
import { framesOf, SPRITES } from "./sprites";
import styles from "./scene.module.css";

/**
 * An agent's figure in a pose: the person's own picture when they gave one, else
 * its pixel animal. A pose with two frames alternates them (a blink, a hammer).
 */
export function Mascot({
  agent,
  look,
  pose = "idle",
  size = 64,
}: {
  agent: Agent;
  look?: Look;
  pose?: Pose;
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
        data-pose={pose}
      />
    );
  const palette = SPRITES[agent].palette;
  const frames = framesOf(agent, pose);
  return (
    <svg
      className={styles.sprite}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      aria-hidden="true"
      data-pose={pose}
      data-frames={frames.length}
    >
      {frames.map((rows, i) => (
        <g key={i} className={styles.spriteFrame}>
          {rows.flatMap((row, y) =>
            [...row].map((cell, x) =>
              cell === "." || !palette[cell] ? null : (
                <rect
                  key={`${x}-${y}`}
                  x={x}
                  y={y}
                  width={1}
                  height={1}
                  fill={palette[cell]}
                />
              ),
            ),
          )}
        </g>
      ))}
    </svg>
  );
}
