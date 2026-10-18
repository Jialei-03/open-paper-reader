import { useI18n } from "../i18n/I18nProvider";
import { Card } from "../ui";

/** A placeholder until the settings screen is built: its card, with its title. */
export function SettingsScreen(_props: { go(hash: string): void }) {
  const { t } = useI18n();
  return (
    <Card
      as="main"
      aria-labelledby="settings-title"
      style={{ flex: 1, padding: "var(--ui-space-16)" }}
    >
      <h1 id="settings-title">{t("reader.sidebar.settings")}</h1>
    </Card>
  );
}
