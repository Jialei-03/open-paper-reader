import { currentPlatformIsMac, formatShortcut } from "./shortcut";
import styles from "./Kbd.module.css";

/**
 * A shortcut as the platform writes it (⌘K on a Mac, Ctrl+K elsewhere). It is
 * hidden from assistive technology: the control it belongs to names the
 * shortcut with `aria-keyshortcuts`.
 */
export function Kbd({ shortcut }: { shortcut: string }) {
  return (
    <kbd className={styles.kbd} aria-hidden="true">
      {formatShortcut(shortcut, currentPlatformIsMac())}
    </kbd>
  );
}
