import { useI18n } from "../i18n/I18nProvider";
import { Card, CardHeader } from "../ui";
import { AccessSection } from "./settings/AccessSection";
import { DataSection } from "./settings/DataSection";
import { ModelsSection } from "./settings/ModelsSection";
import { ResearchSection } from "./settings/ResearchSection";
import {
  AppearanceSection,
  KeypointsSection,
  LanguageSection,
} from "./settings/PreferencesSection";
import styles from "./settings/Settings.module.css";
import { UsageSection } from "./settings/UsageSection";

/**
 * The settings, one column in one card: the models, how the interface looks
 * and speaks, the data and its use, and the links and credentials handed out.
 */
export function SettingsScreen({ go }: { go(hash: string): void }) {
  const { t } = useI18n();
  return (
    <Card as="main" className={styles.card} aria-labelledby="settings-title">
      <CardHeader>
        <h1 id="settings-title" className={styles.cardTitle}>
          {t("settings.title")}
        </h1>
      </CardHeader>
      <div className={styles.body}>
        <div className={styles.column}>
          <ModelsSection />
          <ResearchSection />
          <AppearanceSection />
          <LanguageSection />
          <KeypointsSection />
          <DataSection />
          <UsageSection />
          <AccessSection go={go} />
        </div>
      </div>
    </Card>
  );
}
