import { useEffect, useMemo } from "react";
import type { Paper } from "../api";
import { useI18n } from "../i18n/I18nProvider";
import { looksLikeArxiv, useImports } from "../import/useImports";
import { recentPapers } from "../lib/recent-papers";
import { lastPage } from "../reader/engine/page-memory";
import { followLink, readerHash } from "../reader/route";
import { Card, CardHeader } from "../ui";
import { ImportDrop, useFileDrop } from "./home/ImportDrop";
import styles from "./home/HomeScreen.module.css";

/** How many papers each list shows. */
const CONTINUE_COUNT = 4;
const RECENT_COUNT = 6;

export interface HomeScreenProps {
  owner: string;
  papers: Paper[];
  go(hash: string): void;
  reload(): void;
}

/** True when the focus is where typing goes, so a paste there is the field's own. */
const editing = () => {
  const active = document.activeElement;
  return (
    active instanceof HTMLElement &&
    (active.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))
  );
};

/**
 * The first screen: with papers, the ones to go on reading (at the page they
 * were left at) and the ones imported last; without, a large place to drop a
 * PDF or paste an arXiv link. Either way a drop anywhere on it imports.
 */
export function HomeScreen({ owner, papers, go, reload }: HomeScreenProps) {
  const { t } = useI18n();
  const imports = useImports((paper, only) => {
    reload();
    if (only) go(readerHash({ paperId: paper.id }).slice(1));
  });
  const { over, handlers } = useFileDrop(imports.importFiles);

  // An arXiv link pasted anywhere on the screen (not into a field) imports it.
  const { importUrl } = imports;
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (editing()) return;
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!looksLikeArxiv(text)) return;
      event.preventDefault();
      importUrl(text);
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [importUrl]);

  const reading = useMemo(() => {
    const visits = recentPapers(owner);
    return papers
      .filter((paper) => visits[paper.id])
      .sort((a, b) => visits[b.id] - visits[a.id])
      .slice(0, CONTINUE_COUNT)
      .map((paper) => ({ paper, page: lastPage(owner, paper.id) ?? 1 }));
  }, [owner, papers]);
  const recent = useMemo(
    () =>
      [...papers]
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, RECENT_COUNT),
    [papers],
  );

  return (
    <Card as="main" className={styles.root} aria-labelledby="home-title">
      <div className={styles.frame} {...handlers}>
        <CardHeader>
          <h1 id="home-title" className={styles.heading}>
            {t("home.title")}
          </h1>
        </CardHeader>
        {papers.length === 0 ? (
          <div className={styles.empty}>
            <ImportDrop imports={imports} large over={over} />
          </div>
        ) : (
          <div className={styles.body}>
            <ImportDrop imports={imports} over={over} />
            {reading.length > 0 && (
              <section aria-labelledby="home-continue">
                <h2 id="home-continue" className={styles.sectionTitle}>
                  {t("home.continue")}
                </h2>
                <ul className={styles.cards}>
                  {reading.map(({ paper, page }) => {
                    const hash = readerHash({ paperId: paper.id, page });
                    return (
                      <li key={paper.id}>
                        <a
                          className={styles.continue}
                          href={hash}
                          onClick={followLink(go, hash.slice(1))}
                        >
                          <span className={styles.title}>
                            {paper.title || t("reader.untitled")}
                          </span>
                          <span className={styles.byline}>
                            {paper.authors || t("home.byline.none")}
                          </span>
                          <span className={styles.page}>
                            {t("home.continue.page", { page })}
                          </span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            <section aria-labelledby="home-recent">
              <div className={styles.sectionHead}>
                <h2 id="home-recent" className={styles.sectionTitle}>
                  {t("home.recent")}
                </h2>
                <a
                  className={styles.more}
                  href="#library"
                  onClick={followLink(go, "library")}
                >
                  {t("home.allPapers")}
                </a>
              </div>
              <ul className={styles.rows}>
                {recent.map((paper) => {
                  const hash = readerHash({ paperId: paper.id });
                  return (
                    <li key={paper.id}>
                      <a
                        className={styles.row}
                        href={hash}
                        onClick={followLink(go, hash.slice(1))}
                      >
                        <span className={styles.title}>
                          {paper.title || t("reader.untitled")}
                        </span>
                        <span className={styles.byline}>{paper.authors}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        )}
      </div>
    </Card>
  );
}
