import type { ReactNode } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { LanguageSwitch } from "./LanguageSwitch";
import styles from "./auth.module.css";

/** The page around sign-in and account recovery: the name, the language, one card. */
export function AuthFrame({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <main className={styles.page}>
      <div className={styles.language}>
        <LanguageSwitch />
      </div>
      <a href="#home" className={styles.brand} aria-label={t("login.home")}>
        <img
          className={styles.mark}
          src="/assets/icons/zhijian-book-v5.svg"
          alt=""
        />
        Open Paper Reader
      </a>
      <section className={styles.card}>
        <h1 className={styles.title}>{title}</h1>
        {lead && <p className={styles.lead}>{lead}</p>}
        {children}
      </section>
    </main>
  );
}
