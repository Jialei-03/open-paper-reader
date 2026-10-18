import clsx from "clsx";
import { useState } from "react";
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
  // The picture is the server's, kept by the browser; until it arrives (or if
  // the paper has none) a page of type stands in.
  const [shown, setShown] = useState<{ src: string; ok: boolean } | null>(null);
  const src = pdf?.thumb ?? "";
  const loaded = shown?.src === src && shown.ok;
  const failed = shown?.src === src && !shown.ok;
  return (
    <div className={clsx(styles.thumb, className)} aria-hidden="true">
      {src && !failed ? (
        <img
          className={clsx(styles.image, loaded && styles.loaded)}
          src={src}
          alt=""
          width={360}
          height={466}
          loading="lazy"
          decoding="async"
          draggable={false}
          data-thumb="image"
          onLoad={() => setShown({ src, ok: true })}
          onError={() => setShown({ src, ok: false })}
        />
      ) : null}
      {!loaded ? (
        <div className={styles.placeholder} data-thumb="placeholder">
          <span className={styles.placeholderTitle}>{title}</span>
          <span className={styles.lines}>
            <i />
            <i />
            <i />
            <i />
          </span>
        </div>
      ) : null}
    </div>
  );
}
