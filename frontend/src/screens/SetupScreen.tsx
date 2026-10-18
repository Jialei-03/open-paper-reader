import { useI18n } from "../i18n/I18nProvider";
import { Button, Card } from "../ui";

/** A placeholder until the first-run setup is built: a card with its title. */
export function SetupScreen({ onDone }: { onDone(): void }) {
  const { t } = useI18n();
  return (
    <Card
      as="main"
      aria-labelledby="setup-title"
      style={{ padding: "var(--ui-space-16)" }}
    >
      <h1 id="setup-title">{t("app.setup.title")}</h1>
      <Button onClick={onDone}>{t("app.setup.later")}</Button>
    </Card>
  );
}
