import { useI18n } from "../i18n/I18nProvider";
import { SegmentedControl } from "../ui";

/** The interface language, for the pages a visitor sees before signing in. */
export function LanguageSwitch() {
  const { t, locale, setLocale } = useI18n();
  return (
    <SegmentedControl
      kind="radio"
      size="sm"
      label={t("site.language")}
      value={locale}
      onChange={setLocale}
      options={[
        { value: "zh", label: "中文" },
        { value: "en", label: "English" },
      ]}
    />
  );
}
