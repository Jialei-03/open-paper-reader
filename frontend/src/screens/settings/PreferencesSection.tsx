import { Monitor, Moon, Sun } from "lucide-react";
import { useI18n } from "../../i18n/I18nProvider";
import type { Locale } from "../../i18n/i18n";
import { SegmentedControl, useAppearance, type Appearance } from "../../ui";
import { Section } from "./Section";
import styles from "./Settings.module.css";

/** The theme: light, dark, or the system's. */
export function AppearanceSection() {
  const { t } = useI18n();
  const { mode, setMode } = useAppearance();
  return (
    <Section title={t("settings.appearance.title")}>
      <div className={styles.setting}>
        <span className={styles.settingLabel}>
          {t("settings.appearance.label")}
        </span>
        <SegmentedControl<Appearance>
          kind="radio"
          label={t("settings.appearance.label")}
          value={mode}
          onChange={setMode}
          options={[
            {
              value: "system",
              label: t("settings.appearance.system"),
              icon: Monitor,
            },
            {
              value: "light",
              label: t("settings.appearance.light"),
              icon: Sun,
            },
            { value: "dark", label: t("settings.appearance.dark"), icon: Moon },
          ]}
        />
      </div>
    </Section>
  );
}

/** The interface's language. */
export function LanguageSection() {
  const { t, locale, setLocale } = useI18n();
  return (
    <Section title={t("settings.language.title")}>
      <div className={styles.setting}>
        <span className={styles.settingLabel}>
          {t("settings.language.label")}
        </span>
        <SegmentedControl<Locale>
          kind="radio"
          label={t("settings.language.label")}
          value={locale}
          onChange={setLocale}
          options={[
            { value: "zh", label: t("settings.language.zh") },
            { value: "en", label: t("settings.language.en") },
          ]}
        />
      </div>
    </Section>
  );
}
