import { createPortal } from "react-dom";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { Floating } from "../../ui";
import { followLink, readerHash, type ReaderRoute } from "../route";
import { citeRoute, type CiteMark } from "./marks";
import { markSentence } from "./sentence";
import "./cite.css";
import styles from "./CiteChip.module.css";

/** Where citations lead: the paper and file they are about, and what following one does. */
export interface CiteTarget {
  paperId: string;
  fileId: string;
  onCite(route: ReaderRoute): void;
}

const CiteContext = createContext<CiteTarget | null>(null);

export function CiteProvider({
  target,
  children,
}: {
  target: CiteTarget | null;
  children: ReactNode;
}) {
  return <CiteContext value={target}>{children}</CiteContext>;
}

export const useCiteTarget = () => useContext(CiteContext);

/** How long the pointer rests on a chip before its card opens, and how long the card waits for the pointer to cross to it. */
const OPEN_DELAY_MS = 120;
const CLOSE_GRACE_MS = 200;

/**
 * A citation after the sentence it supports: its number, raised. The card it
 * opens (on hover or keyboard focus) shows the paper's words and their page;
 * pressing it goes to the page and marks that sentence there.
 */
export function CiteChip({
  n,
  mark,
  inNote = false,
}: {
  n: number;
  mark: CiteMark;
  inNote?: boolean;
}) {
  const { t } = useI18n();
  const target = useCiteTarget();
  const [chip, setChip] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef(0);
  const unmark = useRef<() => void>(() => {});
  const id = useId();

  const show = useCallback((delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  }, []);
  const hide = useCallback((delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), delay);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // While the card is open, the sentence the chip closes is marked in the text.
  useEffect(() => {
    if (!open || !chip) return;
    unmark.current = markSentence(chip);
    return () => unmark.current();
  }, [open, chip]);

  if (!target) return null;
  const route = citeRoute(target.paperId, target.fileId, mark);
  const hash = readerHash(route);
  const go = () => {
    setOpen(false);
    const again = window.location.hash === hash;
    target.onCite(route);
    // The same address again: the sentence is sought and marked anew.
    if (again) window.dispatchEvent(new Event("reference-navigate"));
  };
  return (
    <>
      <a
        ref={setChip}
        className={inNote ? `${styles.chip} ${styles.inNote}` : styles.chip}
        href={hash}
        data-cite-chip=""
        data-cite-page={mark.page}
        data-open={open}
        aria-label={t("reader.cite.chip", { n, page: mark.page })}
        aria-describedby={open ? id : undefined}
        onClick={followLink(go, hash.slice(1))}
        onPointerEnter={() => show(OPEN_DELAY_MS)}
        onPointerLeave={() => hide(CLOSE_GRACE_MS)}
        onFocus={() => show(0)}
        onBlur={() => hide(0)}
      >
        {n}
      </a>
      {createPortal(
        <Floating
          open={open}
          anchor={chip}
          role="tooltip"
          id={id}
          placement={{ side: "bottom", align: "center" }}
          offset={6}
          onDismiss={(reason) => reason === "escape" && setOpen(false)}
        >
          <div
            className={styles.card}
            onPointerEnter={() => show(0)}
            onPointerLeave={() => hide(CLOSE_GRACE_MS)}
          >
            <span className={styles.where}>
              {t("reader.cite.page", { page: mark.page })}
            </span>
            <blockquote className={styles.quote}>{mark.quote}</blockquote>
            <span className={styles.hint}>{t("reader.cite.goto")}</span>
          </div>
        </Floating>,
        document.body,
      )}
    </>
  );
}
