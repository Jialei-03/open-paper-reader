import clsx from "clsx";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, Spinner } from "../../ui";
import colors from "./colors.module.css";
import { CATEGORIES, type Keypoint } from "./keypoints";
import styles from "./KeypointsSection.module.css";
import type { Keypoints } from "./useKeypoints";

export interface KeypointsSectionProps {
  keypoints: Keypoints;
  /** A sentence was pressed: the paper goes to it. */
  onJump(item: Keypoint): void;
}

/**
 * The guide's "key sentences": the sentences found in the paper, by kind, with
 * the legend that shows or hides a kind on the pages as well as here.
 * Nothing is shown while the setting is off (or before there is a model).
 */
export function KeypointsSection({ keypoints, onJump }: KeypointsSectionProps) {
  const { t } = useI18n();
  const { state, items, visible, hidden } = keypoints;
  if (state === "off" || state === "loading" || state === "noModel")
    return null;
  const counts = (category: string) =>
    items.filter((item) => item.category === category).length;
  return (
    <section className={styles.section} aria-labelledby="keypoints-heading">
      <h2 id="keypoints-heading" className={styles.label}>
        {t("reader.keypoints.title")}
      </h2>
      {state === "idle" && (
        <div className={styles.message}>
          <p className={styles.note}>{t("reader.keypoints.idle")}</p>
          <Button
            size="sm"
            loading={keypoints.busy}
            onClick={keypoints.generate}
          >
            {t("reader.keypoints.generate")}
          </Button>
        </div>
      )}
      {state === "working" && (
        <p className={styles.status} role="status">
          <Spinner size={14} />
          {t("reader.keypoints.working")}
        </p>
      )}
      {state === "failed" && (
        <div className={styles.message}>
          <p className={styles.error} role="alert">
            {keypoints.error}
          </p>
          <Button
            size="sm"
            loading={keypoints.busy}
            onClick={keypoints.generate}
          >
            {t("common.retry")}
          </Button>
        </div>
      )}
      {state === "ready" && (
        <>
          <ul
            className={styles.legend}
            aria-label={t("reader.keypoints.legend")}
          >
            {CATEGORIES.map((category) => (
              <li key={category}>
                <button
                  type="button"
                  className={clsx(
                    styles.chip,
                    colors[category],
                    colors.onSurface,
                  )}
                  aria-pressed={!hidden.has(category)}
                  onClick={() => keypoints.toggle(category)}
                >
                  <span className={styles.swatch} aria-hidden="true" />
                  {t(`reader.keypoints.${category}`)}
                  <span className={styles.count}>{counts(category)}</span>
                </button>
              </li>
            ))}
          </ul>
          {visible.length === 0 ? (
            <p className={styles.note}>{t("reader.keypoints.allHidden")}</p>
          ) : (
            <ul className={styles.list}>
              {visible.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={clsx(
                      styles.item,
                      colors[item.category],
                      colors.onSurface,
                    )}
                    data-keypoint={item.category}
                    onClick={() => onJump(item)}
                  >
                    <span className={styles.quote}>{item.quote}</span>
                    <span className={styles.meta}>
                      {t(`reader.keypoints.${item.category}`)}
                      {item.reason ? ` · ${item.reason}` : ""}
                      {" · "}
                      <span className={styles.page}>
                        {t("reader.guide.page", { page: item.page })}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
