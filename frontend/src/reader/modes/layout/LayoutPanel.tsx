import { useI18n } from "../../../i18n/I18nProvider";
import { LatexInstall } from "../../../screens/settings/LatexInstall";
import { LayoutInstall } from "../../../screens/settings/LayoutInstall";
import { Button, Spinner } from "../../../ui";
import { lacksSource, layoutState, percentOf } from "./job";
import styles from "./LayoutPanel.module.css";
import type { Layout } from "./useLayoutTranslation";

/** The title, the one line that says what the translation does, and the plain line that says how it is made. */
function About({ layout }: { layout: Layout }) {
  const { t } = useI18n();
  const latex = layout.method === "latex";
  return (
    <>
      <h2 className={styles.title}>
        {t(latex ? "reader.layout.titleLatex" : "reader.layout.title")}
      </h2>
      <p className={styles.about}>
        {t(latex ? "reader.layout.aboutLatex" : "reader.layout.about")}
      </p>
      <p className={styles.method}>
        {t(latex ? "reader.layout.methodLatex" : "reader.layout.methodPdf")}
      </p>
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

/** Translating on the original PDF instead, where the service can; the local build can install it. */
function UsePdf({
  layout,
  variant,
}: {
  layout: Layout;
  variant: "primary" | "ghost";
}) {
  const { t } = useI18n();
  if (!layout.layoutAvailable)
    return variant === "primary" ? <LayoutInstall compact /> : null;
  return (
    <Button
      variant={variant}
      loading={layout.busy}
      disabled={!layout.hasModel}
      onClick={() => layout.start("pdf")}
    >
      {t("reader.layout.usePdf")}
    </Button>
  );
}

/**
 * What the paper area shows in the translated view while there is no translated
 * PDF to show: what the translation is, how it is made (from the arXiv LaTeX
 * source, or on the original PDF), and a button to start it; how it is going and
 * a way to stop it; or why it failed and a way to try again — and where arXiv
 * has no LaTeX source, the PDF way instead. Where the service cannot make one,
 * or there is no model, it says so.
 */
export function LayoutPanel({ layout }: { layout: Layout }) {
  const { t } = useI18n();
  const state = layoutState(layout.job);
  const latex = layout.method === "latex";
  // An arXiv paper read on the PDF way only because the TeX engine is not installed (local build).
  const offerLatex = !latex && layout.arxiv && layout.latexInstallable;

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
            <About layout={layout} />
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
        ) : state === "failed" && lacksSource(layout.job) ? (
          <>
            <h2 className={styles.title}>{t("reader.layout.noSource")}</h2>
            <p className={styles.about}>{t("reader.layout.noSourceNote")}</p>
            <div className={styles.actions}>
              <UsePdf layout={layout} variant="primary" />
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
                onClick={() => layout.start()}
              >
                {t("common.retry")}
              </Button>
              {latex && <UsePdf layout={layout} variant="ghost" />}
            </div>
          </>
        ) : !layout.available ? (
          latex || offerLatex ? (
            <>
              <h2 className={styles.title}>
                {t("reader.layout.latexMissing")}
              </h2>
              <p className={styles.about}>
                {t("reader.layout.latexMissingNote")}
              </p>
              <LatexInstall compact />
            </>
          ) : (
            <>
              <h2 className={styles.title}>{t("reader.layout.disabled")}</h2>
              <p className={styles.about}>{t("reader.layout.disabledNote")}</p>
              {/* The local build installs it on demand; elsewhere this shows nothing. */}
              <LayoutInstall compact />
            </>
          )
        ) : !layout.hasModel ? (
          <>
            <About layout={layout} />
            <p className={styles.note}>{t("reader.layout.noModel")}</p>
            <div className={styles.actions}>
              <a className={styles.link} href="#settings">
                {t("reader.layout.toSettings")}
              </a>
            </div>
          </>
        ) : (
          <>
            <About layout={layout} />
            <div className={styles.actions}>
              <Button
                variant="primary"
                loading={layout.busy}
                onClick={() => layout.start()}
              >
                {t(latex ? "reader.layout.startLatex" : "reader.layout.start")}
              </Button>
            </div>
            <p className={styles.note}>{t("reader.layout.timeNote")}</p>
            {offerLatex && (
              <div className={styles.offer}>
                <p className={styles.note}>{t("reader.layout.latexOffer")}</p>
                <LatexInstall compact />
              </div>
            )}
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
