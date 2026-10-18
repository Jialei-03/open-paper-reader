import type { Paper } from "../api";
import { useI18n } from "../i18n/I18nProvider";
import { Card } from "../ui";

/** A placeholder until the home screen is built: its card, with its title. */
export function HomeScreen(_props: {
  owner: string;
  papers: Paper[];
  go(hash: string): void;
  reload(): void;
}) {
  const { t } = useI18n();
  return (
    <Card
      as="main"
      aria-labelledby="home-title"
      style={{ flex: 1, padding: "var(--ui-space-16)" }}
    >
      <h1 id="home-title">{t("app.home")}</h1>
    </Card>
  );
}
