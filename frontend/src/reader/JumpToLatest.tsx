import { useEffect, useState, type RefObject } from "react";
import { useI18n } from "../i18n/I18nProvider";
import styles from "./JumpToLatest.module.css";

/** Further than this from the foot, the view counts as scrolled away from the latest. */
const AWAY = 120;

/**
 * A round button over the foot of the assistant's view that takes the reader
 * back to the latest: shown only while the view is scrolled away from the
 * bottom. While an answer is being written below, it carries a small dot.
 * Scrolling to the foot also puts the thread back to following its newest
 * text (it follows whenever the view is at the foot).
 */
export function JumpToLatest({
  scroller,
  streaming,
}: {
  scroller: RefObject<HTMLElement | null>;
  streaming: boolean;
}) {
  const { t } = useI18n();
  const [away, setAway] = useState(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () =>
      setAway(el.scrollHeight - el.scrollTop - el.clientHeight > AWAY);
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [scroller]);

  const jump = () => {
    const el = scroller.current;
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: still ? "auto" : "smooth" });
  };

  return (
    <button
      type="button"
      className={styles.jump}
      data-shown={away || undefined}
      data-streaming={(away && streaming) || undefined}
      aria-label={t("reader.panel.latest")}
      title={t("reader.panel.latest")}
      tabIndex={away ? 0 : -1}
      aria-hidden={away ? undefined : true}
      onClick={jump}
    >
      <svg
        className={styles.arrow}
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M8 3v9M4 8.5l4 4 4-4" />
      </svg>
      {away && streaming && (
        <span className={styles.dot} data-testid="latest-dot" />
      )}
    </button>
  );
}
