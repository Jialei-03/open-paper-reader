import styles from "./Spinner.module.css";

/** A ring that turns; it takes the color of the text around it. Decorative: say what is busy elsewhere (`aria-busy`). */
export function Spinner({ size = 16 }: { size?: 14 | 16 }) {
  return (
    <svg
      className={styles.spinner}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" opacity="0.25" />
      <path d="M8 2a6 6 0 0 1 6 6" strokeLinecap="round" />
    </svg>
  );
}
