import { useI18n } from "../../i18n/I18nProvider";
import { byline } from "../../reader/citations/lookup";
import { followLink } from "../../reader/route";
import { useRecommendations } from "../discover/useRecommendations";
import styles from "./HomeRecommend.module.css";

const COUNT = 3;

/**
 * Three suggested papers, with a way to the rest. It shows only when there is
 * something to show: no recommendations, a server that looks nothing up, or a
 * failed request leave home as it was.
 */
export function HomeRecommend({ go }: { go(hash: string): void }) {
  const { t } = useI18n();
  const recs = useRecommendations(COUNT);
  const items =
    recs.data?.state === "ok" ? recs.data.items.slice(0, COUNT) : [];
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="home-recommend" data-testid="home-recommend">
      <div className={styles.head}>
        <h2 id="home-recommend" className={styles.title}>
          {t("home.recommend")}
        </h2>
        <a
          className={styles.more}
          href="#discover"
          onClick={followLink(go, "discover")}
        >
          {t("home.recommend.all")}
        </a>
      </div>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.key}>
            <a
              className={styles.item}
              href="#discover"
              onClick={followLink(go, "discover")}
            >
              <span className={styles.name}>{item.title}</span>
              <span className={styles.byline}>
                {byline(
                  item,
                  (authors) => t("reader.link.etAl", { authors }),
                  2,
                )}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
