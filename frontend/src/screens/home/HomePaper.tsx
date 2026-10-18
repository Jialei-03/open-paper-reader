import clsx from "clsx";
import { useRef } from "react";
import type { Paper } from "../../api";
import { useI18n } from "../../i18n/I18nProvider";
import { followLink, readerHash } from "../../reader/route";
import { PaperThumb } from "../library/PaperThumb";
import { useProgressText } from "../library/PaperItem";
import { usePaperFacts } from "../library/usePaperFacts";
import styles from "./HomePaper.module.css";

/**
 * A paper on the home screen, the whole of it a link. The `continue` kind is for
 * the ones being read (it opens at the page left at, and shows how far along it
 * is); the `small` kind is for the ones imported last.
 */
export function HomePaper({
  paper,
  owner,
  kind,
  page,
  go,
}: {
  paper: Paper;
  owner: string;
  kind: "continue" | "small";
  /** The page a `continue` card opens at. */
  page?: number;
  go(hash: string): void;
}) {
  const { t } = useI18n();
  const progressText = useProgressText();
  const link = useRef<HTMLAnchorElement>(null);
  const facts = usePaperFacts(paper, owner, link);
  const hash = readerHash({ paperId: paper.id, page });
  return (
    <a
      ref={link}
      className={clsx(styles.paper, styles[kind])}
      href={hash}
      onClick={followLink(go, hash.slice(1))}
    >
      <PaperThumb paper={paper} pdf={facts.pdf} className={styles.cover} />
      <span className={styles.text}>
        <span className={styles.title}>
          {paper.title || t("reader.untitled")}
        </span>
        <span className={styles.byline}>
          {facts.byline || t("home.byline.none")}
        </span>
        {kind === "continue" && (
          <span className={styles.progress}>
            <span className={styles.bar}>
              <i style={{ width: `${facts.progress * 100}%` }} />
            </span>
            <span className={styles.page}>
              {progressText(page ?? facts.page, facts.pages)}
            </span>
          </span>
        )}
      </span>
    </a>
  );
}
