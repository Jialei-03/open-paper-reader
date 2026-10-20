import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { followLink } from "../../reader/route";
import { listWorkspaces, type WorkspaceRow } from "../research/research-api";
import styles from "./HomeRecommend.module.css";

const COUNT = 3;

/**
 * The research projects touched last, each saying what it needs from the
 * researcher first; with none yet, the way to start one. Absent when research
 * cannot be reached (the request fails), so reading-only home stays as it was.
 */
export function HomeResearch({ go }: { go(hash: string): void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<WorkspaceRow[] | null>(null);
  useEffect(() => {
    listWorkspaces().then(setRows, () => setRows(null));
  }, []);
  if (!rows) return null;
  const mine = rows
    .filter((w) => !w.archived && w.kind === "research")
    .sort((a, b) => b.active_at.localeCompare(a.active_at))
    .slice(0, COUNT);
  const state = (w: WorkspaceRow) =>
    w.waiting > 0
      ? t("home.research.waiting", { n: w.waiting })
      : w.running > 0
        ? t("home.research.running", { n: w.running })
        : w.researches > 0
          ? t("home.research.count", { n: w.researches })
          : t("home.research.none");
  return (
    <section aria-labelledby="home-research" data-testid="home-research">
      <div className={styles.head}>
        <h2 id="home-research" className={styles.title}>
          {t("home.research")}
        </h2>
        {mine.length > 0 && (
          <a
            className={styles.more}
            href="#projects"
            onClick={followLink(go, "projects")}
          >
            {t("home.research.all")}
          </a>
        )}
      </div>
      <ul className={styles.list}>
        {mine.length === 0 ? (
          <li>
            <a
              className={styles.item}
              href="#projects"
              onClick={followLink(go, "projects")}
            >
              <span className={styles.name}>{t("home.research.start")}</span>
              <span className={styles.byline}>
                {t("home.research.startLead")}
              </span>
            </a>
          </li>
        ) : (
          mine.map((w) => (
            <li key={w.id}>
              <a
                className={styles.item}
                href={`#projects/${w.id}`}
                onClick={followLink(go, `projects/${w.id}`)}
              >
                <span className={styles.name}>{w.name}</span>
                <span className={styles.byline}>{state(w)}</span>
              </a>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
