import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import styles from "./CustomizeScreen.module.css";

export function CustomizeHeader({
  title,
  query,
  onQuery,
  action,
  status,
}: {
  title: string;
  query: string;
  onQuery(query: string): void;
  action?: ReactNode;
  status?: string;
}) {
  const { t } = useI18n();
  return (
    <header className={styles.header}>
      <div>
        <h1>{title}</h1>
        {status && <span className={styles.status}>{status}</span>}
      </div>
      <div className={styles.actions}>
        <label className={styles.search}>
          <Search size={16} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder={t("customize.search")}
            aria-label={t("customize.search")}
          />
        </label>
        {action}
      </div>
    </header>
  );
}
