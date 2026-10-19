import { ArrowRight, Check, Copy, Github } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/i18n";
import { useAppearance } from "../ui/theme";
import { LanguageSwitch } from "./LanguageSwitch";
import styles from "./product-site.module.css";

export const REPOSITORY = "https://github.com/Jialei-03/open-research-agent";

export const INSTALL =
  "git clone https://github.com/Jialei-03/open-research-agent";

const steps = [
  ["import", "01", null],
  ["guide", "02", "guide"],
  ["select", "03", "select"],
  ["ask", "04", "reader"],
] as const;

const modes = ["original", "parallel", "translated"] as const;
const research = ["map", "focus", "advisor", "evidence", "playbook"] as const;
const local = ["data", "account", "models", "planned"] as const;

function InstallCommand() {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL);
      setCopied(true);
    } catch {
      /* The command is on screen to select. */
    }
  };
  return (
    <div className={styles.install}>
      <span className={styles.installLabel}>{t("site.hero.install")}</span>
      <div className={styles.command}>
        <code>{INSTALL}</code>
        <button
          type="button"
          className={styles.copy}
          onClick={copy}
          aria-label={t("site.hero.copy")}
        >
          {copied ? (
            <Check size={14} aria-hidden="true" />
          ) : (
            <Copy size={14} aria-hidden="true" />
          )}
          <span role="status">{copied ? t("site.hero.copied") : ""}</span>
        </button>
      </div>
      <p className={styles.note}>{t("site.hero.note")}</p>
    </div>
  );
}

/** Fade a block in once as it scrolls into view; blocks already in view just show. */
function useReveal() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const items = root.current?.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!items?.length || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.setAttribute("data-shown", "");
          io.unobserve(entry.target);
        }),
      { rootMargin: "0px 0px -8% 0px" },
    );
    items.forEach((item) => io.observe(item));
    return () => io.disconnect();
  }, []);
  return root;
}

export function ProductSite({ path }: { path: string }) {
  const { t, locale } = useI18n();
  const { theme } = useAppearance();
  const root = useReveal();
  useEffect(() => {
    document.title = `Open Research Agent · ${t("site.hero.title")}`;
  }, [t]);
  useEffect(() => {
    if (path !== "how") return;
    document.getElementById("how")?.scrollIntoView();
  }, [path]);
  const key = (name: string) => `site.how.${name}` as MessageKey;
  const picture = (view: string, alt: string, lazy = true) => (
    <img
      src={`/assets/site/${view}-${theme}${locale === "en" ? "-en" : ""}.png`}
      width={1440}
      height={900}
      alt={alt}
      loading={lazy ? "lazy" : undefined}
      decoding="async"
      fetchPriority={lazy ? undefined : "high"}
    />
  );
  return (
    <div className={styles.site} ref={root}>
      <header className={styles.header}>
        <a href="#home" className={styles.brand}>
          <img
            className={styles.mark}
            src="/assets/icons/opr-mark.svg"
            alt=""
          />
          Open Research Agent
        </a>
        <nav aria-label={t("site.nav")} className={styles.nav}>
          <a href="#research" className={styles.navLink}>
            {t("site.nav.research")}
          </a>
          <a href="#how" className={styles.navLink}>
            {t("site.nav.how")}
          </a>
          <a href="#local" className={styles.navLink}>
            {t("site.nav.local")}
          </a>
          <a
            className={styles.navLink}
            href={REPOSITORY}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("site.nav.github")}
          </a>
          <LanguageSwitch />
          <a href="#dashboard" className={styles.primary}>
            {t("site.nav.start")}
          </a>
        </nav>
      </header>
      <main>
        <section className={styles.hero}>
          <h1 className={styles.title}>{t("site.hero.title")}</h1>
          <p className={styles.lead}>{t("site.hero.lead")}</p>
          <InstallCommand />
          <div className={styles.actions}>
            <a href="#dashboard" className={styles.primary}>
              {t("site.hero.start")}
              <ArrowRight size={16} aria-hidden="true" />
            </a>
            <a
              className={styles.secondary}
              href={REPOSITORY}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github size={16} aria-hidden="true" />
              {t("site.hero.source")}
            </a>
          </div>
          <figure className={styles.shot}>
            {picture("research", t("site.shot.alt"), false)}
          </figure>
        </section>
        <section
          id="research"
          className={styles.section}
          aria-labelledby="research-title"
        >
          <h2 id="research-title" className={styles.heading} data-reveal>
            {t("site.research.title")}
          </h2>
          <p className={styles.body} data-reveal>
            {t("site.research.body")}
          </p>
          <div className={styles.modes} data-reveal>
            {research.map((name) => (
              <div key={name} className={styles.mode}>
                <h3>{t(`site.research.${name}.title` as MessageKey)}</h3>
                <p>{t(`site.research.${name}.body` as MessageKey)}</p>
              </div>
            ))}
          </div>
        </section>
        <section
          id="how"
          className={styles.section}
          aria-labelledby="how-title"
        >
          <h2 id="how-title" className={styles.heading} data-reveal>
            {t("site.how.title")}
          </h2>
          <ol className={styles.steps}>
            {steps.map(([name, number, view]) => (
              <li key={name} className={styles.step} data-reveal>
                <div className={styles.stepText}>
                  <span className={styles.number}>{number}</span>
                  <h3>{t(key(`${name}.title`))}</h3>
                  <p>{t(key(`${name}.body`))}</p>
                </div>
                {view && (
                  <figure className={styles.figure}>
                    {picture(view, t(key(`${name}.alt`)))}
                  </figure>
                )}
              </li>
            ))}
          </ol>
        </section>
        <section
          id="modes"
          className={styles.section}
          aria-labelledby="modes-title"
        >
          <h2 id="modes-title" className={styles.heading} data-reveal>
            {t("site.modes.title")}
          </h2>
          <p className={styles.body} data-reveal>
            {t("site.modes.body")}
          </p>
          <div className={styles.modes} data-reveal>
            {modes.map((name) => (
              <div key={name} className={styles.mode}>
                <h3>{t(`site.modes.${name}.title` as MessageKey)}</h3>
                <p>{t(`site.modes.${name}.body` as MessageKey)}</p>
              </div>
            ))}
          </div>
          <figure className={styles.figure} data-reveal>
            {picture("parallel", t("site.modes.alt"))}
          </figure>
        </section>
        <section
          id="local"
          className={styles.section}
          aria-labelledby="local-title"
        >
          <h2 id="local-title" className={styles.heading} data-reveal>
            {t("site.local.title")}
          </h2>
          <p className={styles.body} data-reveal>
            {t("site.local.body")}
          </p>
          <ul className={styles.facts} data-reveal>
            {local.map((name) => (
              <li key={name} className={styles.fact}>
                <h3>{t(`site.local.${name}.title` as MessageKey)}</h3>
                <p>{t(`site.local.${name}.body` as MessageKey)}</p>
              </li>
            ))}
          </ul>
        </section>
        <section className={styles.open} data-reveal>
          <h2 className={styles.heading}>{t("site.open.title")}</h2>
          <p className={styles.body}>{t("site.open.body")}</p>
          <div className={styles.actions}>
            <a
              className={styles.secondary}
              href={REPOSITORY}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github size={16} aria-hidden="true" />
              {t("site.open.source")}
            </a>
            <a href="#dashboard" className={styles.primary}>
              {t("site.hero.start")}
              <ArrowRight size={16} aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <span>Open Research Agent</span>
        <span>{t("site.footer")}</span>
      </footer>
    </div>
  );
}
