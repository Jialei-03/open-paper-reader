import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/i18n";
import { followLink } from "../../reader/route";
import {
  recentResearches,
  type RecentResearch,
} from "../research/research-api";
import styles from "./HomeResearch.module.css";

const COUNT = 6;
const PARTS = ["supported", "refuted", "abandoned", "open"] as const;

/**
 * The researches touched last, waiting ones first: what each asks, where it
 * stands, its answer or what it is doing, and how many hypotheses are settled.
 * Absent when research cannot be reached, so reading-only home stays as it was.
 */
export function HomeResearch({ go }: { go(hash: string): void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<RecentResearch[] | null>(null);
  useEffect(() => {
    recentResearches(COUNT).then(setRows, () => setRows(null));
  }, []);
  if (!rows) return null;
  return (
    <section aria-labelledby="home-research" data-testid="home-research">
      <div className={styles.head}>
        <h2 id="home-research" className={styles.title}>
          {t("home.research")}
        </h2>
        <a
          className={styles.more}
          href="#projects"
          onClick={followLink(go, "projects")}
        >
          {t(rows.length ? "home.research.all" : "home.research.start")}
        </a>
      </div>
      {rows.length > 0 && (
        <ul className={styles.grid}>
          {rows.map((r) => (
            <li key={r.id}>
              <Card r={r} go={go} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Card({ r, go }: { r: RecentResearch; go(hash: string): void }) {
  const { t } = useI18n();
  const h = r.hypotheses ?? { supported: 0, refuted: 0, abandoned: 0, open: 0 };
  const total = PARTS.reduce((n, k) => n + h[k], 0);
  const settled = total - h.open;
  const status =
    r.column === "running" || r.column === "todo"
      ? t(`research.stage.${r.stage}` as MessageKey)
      : t(`projects.column.${r.column}` as MessageKey);
  const line = r.column === "done" ? r.conclusion || r.said : r.said;
  const hash = `research/${r.id}`;
  return (
    <a
      className={styles.card}
      href={`#${hash}`}
      onClick={followLink(go, hash)}
      data-column={r.column}
    >
      <span className={styles.top}>
        <span className={styles.status} data-column={r.column}>
          {status}
          {r.waiting > 1 && ` · ${r.waiting}`}
        </span>
        <span className={styles.project}>{r.workspace}</span>
      </span>
      <span className={styles.question}>{r.question}</span>
      {line && <span className={styles.line}>{line}</span>}
      <span className={styles.foot}>
        {total > 0 && (
          <span
            className={styles.progress}
            title={t("home.research.hypotheses", { done: settled, total })}
          >
            <span className={styles.bar} aria-hidden>
              {PARTS.map(
                (k) =>
                  h[k] > 0 && (
                    <span key={k} data-part={k} style={{ flexGrow: h[k] }} />
                  ),
              )}
            </span>
            {settled}/{total}
          </span>
        )}
        {r.best && (
          <span className={styles.metric}>
            {r.best.name} {r.best.value.toPrecision(4)}
          </span>
        )}
        {r.column === "review" && (
          <span className={styles.decide}>{t("home.research.decide")}</span>
        )}
      </span>
    </a>
  );
}
