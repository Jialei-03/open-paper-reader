import { motion, useReducedMotion } from "motion/react";

/** The soft pill behind the active navigation item. The active item renders
 * one, and every pill shares a layout id, so when the active item changes the
 * pill slides from the old item to the new one instead of jumping. */
export function NavPill() {
  const reducedMotion = useReducedMotion();
  return (
    <motion.span
      aria-hidden
      layoutId="workspace-nav-pill"
      className="workspace-nav-highlight"
      style={{ borderRadius: 9 }}
      transition={
        reducedMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 380, damping: 34 }
      }
    />
  );
}
