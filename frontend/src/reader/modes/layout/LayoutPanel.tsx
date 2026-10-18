import { useI18n } from "../../../i18n/I18nProvider";
import { LayoutInstall } from "../../../screens/settings/LayoutInstall";
import { Button, Spinner } from "../../../ui";
import { layoutState, percentOf } from "./job";
import styles from "./LayoutPanel.module.css";
import type { Layout } from "./useLayoutTranslation";

/** The title, and the one line that says what a layout translation does. */
function About() {
  const { t } = useI18n();
  return (
    <>
      <h2 className={styles.title}>{t("reader.layout.title")}</h2>
      <p className={styles.about}>{t("reader.layout.about")}</p>
    </>
  );
}

/** How far a running translation has got: the service's words for the stage, and a bar. */
function Progress({ layout }: { layout: Layout }) {
  const { t } = useI18n();
  const { job } = layout;
  if (!job) return null;
  const percent = percentOf(job);
  const queued = job.status === "queued";
  return (
    <div className={styles.progress}>
      <p className={styles.stage} role="status">
        <span>{job.stage || (queued ? t("reader.layout.queued") : "")}</span>
        {percent !== null && (
          <span className={styles.percent}>
            {t("reader.layout.percent", { percent })}
          </span>
        )}
      </p>
      <div
        className={styles.track}
        role="progressbar"
        aria-label={t("reader.layout.progress")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        <span
          className={styles.fill}
          style={{ transform: `scaleX(${(percent ?? 0) / 100})` }}
        />
      </div>
    </div>
  );
}

/**
 * What the paper area shows in the translated view while there is no translated
 * PDF to show: what a layout translation is and a button to start it; how it is
 * going and a way to stop it; or why it failed and a way to try again. Where
 * the service cannot make one, or there is no model, it says so.
 */
export function LayoutPanel({ layout }: { layout: Layout }) {
  const { t } = useI18n();
  const state = layoutState(layout.job);

  if (layout.loading)
    return (
      <div
        className={styles.panel}
        role="status"
        aria-label={t("reader.layout.checking")}
      >
        <Spinner />
      </div>
    );

  return (
    <section className={styles.panel} aria-label={t("reader.layout.region")}>
      <div className={styles.inner}>
        {state === "running" ? (
          <>
            <About />
            <Progress layout={layout} />
            <div className={styles.actions}>
              <Button
                variant="ghost"
                loading={layout.busy}
                onClick={layout.cancel}
              >
                {t("reader.layout.cancel")}
              </Button>
            </div>
          </>
        ) : state === "failed" ? (
          <>
            <h2 className={styles.title}>{t("reader.layout.failed")}</h2>
            {layout.job?.error && (
              <p className={styles.reason}>{layout.job.error}</p>
            )}
            <div className={styles.actions}>
              <Button
                variant="primary"
                loading={layout.busy}
                disabled={!layout.available || !layout.hasModel}
                onClick={layout.start}
              >
                {t("common.retry")}
              </Button>
            </div>
          </>
        ) : !layout.available ? (
          <>
            <h2 className={styles.title}>{t("reader.layout.disabled")}</h2>
            <p className={styles.about}>{t("reader.layout.disabledNote")}</p>
            {/* The local build installs it on demand; elsewhere this shows nothing. */}
            <LayoutInstall compact />
          </>
        ) : !layout.hasModel ? (
          <>
            <About />
            <p className={styles.note}>{t("reader.layout.noModel")}</p>
            <div className={styles.actions}>
              <a className={styles.link} href="#settings">
                {t("reader.layout.toSettings")}
              </a>
            </div>
          </>
        ) : (
          <>
            <About />
            <div className={styles.actions}>
              <Button
                variant="primary"
                loading={layout.busy}
                onClick={layout.start}
              >
                {t("reader.layout.start")}
              </Button>
            </div>
            <p className={styles.note}>{t("reader.layout.timeNote")}</p>
          </>
        )}
        {layout.error && (
          <p className={styles.error} role="alert">
            {layout.error}
          </p>
        )}
      </div>
    </section>
  );
}
