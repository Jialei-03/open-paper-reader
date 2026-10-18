import { useMemo, type ReactNode } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import type { PdfController } from "../../engine/PdfPages";
import styles from "./CompareView.module.css";
import { scrollMap, type AlignmentUnit } from "./scroll-map";
import { useLinkedPanes } from "./useLinkedPanes";

export interface CompareViewProps {
  original: PdfController | null;
  translated: PdfController | null;
  /** The pages of each PDF, once known (0 until its document has opened). */
  pages: { original: number; translated: number };
  alignment: readonly AlignmentUnit[] | null | undefined;
  linked: boolean;
  swapped: boolean;
  /** What each pane holds: the pages, or while the PDF opens, why they are not there. */
  panes: { original: ReactNode; translated: ReactNode };
}

/** Whether the job's alignment gives any pair of pages to match the panes by. */
export function useScrollMap(
  alignment: CompareViewProps["alignment"],
  pages: CompareViewProps["pages"],
) {
  return useMemo(
    () => scrollMap(alignment, pages.original, pages.translated),
    [alignment, pages.original, pages.translated],
  );
}

/**
 * The original and its translation, side by side, each a whole PDF with its
 * own scroll. The panes keep step (`useLinkedPanes`): the same zoom, and, when
 * linked, the same place of the paper, whichever the person scrolls.
 */
export function CompareView({
  original,
  translated,
  pages,
  alignment,
  linked,
  swapped,
  panes,
}: CompareViewProps) {
  const { t } = useI18n();
  const map = useScrollMap(alignment, pages);
  useLinkedPanes({ original, translated, map, pages, linked });
  return (
    <div className={styles.view} data-swapped={swapped} data-linked={linked}>
      <section
        className={styles.pane}
        data-pane="original"
        aria-label={t("reader.compare.original")}
      >
        <h2 className={styles.caption}>{t("reader.compare.original")}</h2>
        {panes.original}
      </section>
      <section
        className={styles.pane}
        data-pane="translated"
        aria-label={t("reader.compare.translated")}
      >
        <h2 className={styles.caption}>{t("reader.compare.translated")}</h2>
        {panes.translated}
      </section>
    </div>
  );
}
