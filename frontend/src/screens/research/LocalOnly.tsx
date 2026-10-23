import { FlaskConical } from "lucide-react";
import { useI18n } from "../../i18n/I18nProvider";
import { REPOSITORY } from "../../features/ProductSite";
import { Button } from "../../ui";
import styles from "./Workspace.module.css";

export function LocalOnly() {
  const { t } = useI18n();
  return (
    <main className={styles.newPage} data-testid="research-local-only">
      <FlaskConical size={36} aria-hidden />
      <h1>{t("research.localOnly.title")}</h1>
      <Button
        onClick={() => window.open(REPOSITORY, "_blank", "noopener,noreferrer")}
      >
        {t("research.localOnly.guide")}
      </Button>
    </main>
  );
}
