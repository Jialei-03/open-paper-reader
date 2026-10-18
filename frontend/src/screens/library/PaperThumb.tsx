import clsx from "clsx";
import type { Paper } from "../../api";
import { useI18n } from "../../i18n/I18nProvider";
import type { PaperPdf } from "./thumbnail";
import styles from "./PaperThumb.module.css";

/**
 * The first page of a paper as a small picture, cropped from the top. While the
 * page is being drawn, or when it cannot be, a page of type stands in: the
 * title set the way the paper's own would be.
 */
export function PaperThumb({
  paper,
  pdf,
  className,
}: {
  paper: Paper;
  pdf: PaperPdf | null;
  className?: string;
}) {
  const { t } = useI18n();
  const title = paper.title || t("reader.untitled");
  return (
    <div className={clsx(styles.thumb, className)} aria-hidden="true">
      {pdf?.thumb ? (
        <img
          className={styles.image}
          src={pdf.thumb}
          alt=""
          draggable={false}
          data-thumb="image"
        />
      ) : (
        <div className={styles.placeholder} data-thumb="placeholder">
          <span className={styles.placeholderTitle}>{title}</span>
          <span className={styles.lines}>
            <i />
            <i />
            <i />
            <i />
          </span>
        </div>
      )}
    </div>
  );
}
