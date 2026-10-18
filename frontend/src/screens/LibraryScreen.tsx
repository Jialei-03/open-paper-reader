import type { Paper } from "../api";
import { useI18n } from "../i18n/I18nProvider";
import { Card } from "../ui";

/** A placeholder until the library screen is built: its card, with its title. */
export function LibraryScreen(_props: {
  owner: string;
  papers: Paper[];
  go(hash: string): void;
  reload(): void;
}) {
  const { t } = useI18n();
  return (
    <Card
      as="main"
      aria-labelledby="library-title"
      style={{ flex: 1, padding: "var(--ui-space-16)" }}
    >
      <h1 id="library-title">{t("reader.sidebar.library")}</h1>
    </Card>
  );
}
