import clsx from "clsx";
import type { CSSProperties, ReactNode } from "react";
import styles from "./Shell.module.css";

/**
 * The whole window: the sidebar (if any) and the cards that float beside it on
 * the shell's own background, 8px apart and 8px in from the edge. It is as high
 * as the window, so what is taller than a card scrolls inside the card.
 */
export function Shell({
  sidebar,
  children,
}: {
  sidebar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      {sidebar}
      <div className={styles.cards}>{children}</div>
    </div>
  );
}

export interface CardProps {
  /** The element: a card that is a landmark of the page says so (`main`, `aside`). */
  as?: "section" | "div" | "main" | "aside";
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-hidden"?: boolean;
  /** Out of reach of the keyboard and pointer while it is put away. */
  inert?: boolean;
}

/**
 * A sheet raised off the shell. It sets its own surface only; how wide it is,
 * and which part of it scrolls, is up to the one that uses it.
 */
export function Card({ as: Tag = "div", className, ...rest }: CardProps) {
  return <Tag {...rest} className={clsx(styles.card, className)} />;
}

/** The strip on top of a card: a title, and the controls that belong to it. It never shrinks. */
export function CardHeader({ children }: { children: ReactNode }) {
  return <header className={styles.header}>{children}</header>;
}
