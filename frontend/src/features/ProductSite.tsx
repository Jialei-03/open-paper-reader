import { ArrowRight, Github } from "lucide-react";
import { useEffect, useRef } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/i18n";
import { useAppearance } from "../ui/theme";
import { LanguageSwitch } from "./LanguageSwitch";
import styles from "./product-site.module.css";

export const REPOSITORY = "https://github.com/Jialei-03/zhijian";

const steps = [
  ["import", "01"],
  ["guide", "02"],
  ["select", "03"],
  ["ask", "04"],
] as const;

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
    document.title = `open-paper-reader · ${t("site.hero.title")}`;
  }, [t]);
  useEffect(() => {
    if (path !== "how") return;
    document.getElementById("how")?.scrollIntoView();
  }, [path]);
  const key = (name: string) => `site.how.${name}` as MessageKey;
  return (
    <div className={styles.site} ref={root}>
      <header className={styles.header}>
        <a href="#home" className={styles.brand}>
          <img
            className={styles.mark}
            src="/assets/icons/zhijian-book-v5.svg"
            alt=""
          />
          open-paper-reader
        </a>
        <nav aria-label={t("site.nav")} className={styles.nav}>
          <a href="#how" className={styles.navLink}>
            {t("site.nav.how")}
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
            <img
              src={`/assets/site/reader-${theme}${locale === "en" ? "-en" : ""}.png`}
              width={1440}
              height={900}
              alt={t("site.shot.alt")}
              fetchPriority="high"
            />
          </figure>
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
            {steps.map(([name, number], index) => (
              <li
                key={name}
                className={styles.step}
                data-reveal
                style={{ transitionDelay: `${index * 60}ms` }}
              >
                <span className={styles.number}>{number}</span>
                <h3>{t(key(`${name}.title`))}</h3>
                <p>{t(key(`${name}.body`))}</p>
              </li>
            ))}
          </ol>
        </section>
        <section className={styles.section} data-reveal>
          <h2 className={styles.heading}>{t("site.modes.title")}</h2>
          <p className={styles.body}>{t("site.modes.body")}</p>
        </section>
        <section className={styles.open} data-reveal>
          <h2 className={styles.heading}>{t("site.open.title")}</h2>
          <p className={styles.body}>{t("site.open.body")}</p>
          <div className={styles.actions}>
            <a href="#dashboard" className={styles.primary}>
              {t("site.hero.start")}
              <ArrowRight size={16} aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <span>open-paper-reader</span>
        <span>{t("site.footer")}</span>
      </footer>
    </div>
  );
}
