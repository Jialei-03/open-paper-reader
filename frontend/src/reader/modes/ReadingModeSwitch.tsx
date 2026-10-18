import { useI18n } from "../../i18n/I18nProvider";
import { SegmentedControl, type SegmentedOption } from "../../ui";
import type { ReadingMode } from "./mode";

export interface ReadingModeSwitchProps {
  mode: ReadingMode;
  onChange(mode: ReadingMode): void;
}

/**
 * How the paper is read, in the strip on top of its card: the original, beside
 * its translation, or the translated PDF. The labels are as short as they can
 * be, so that the strip has room for the title as well.
 */
export function ReadingModeSwitch({ mode, onChange }: ReadingModeSwitchProps) {
  const { t } = useI18n();
  const options: SegmentedOption<ReadingMode>[] = [
    { value: "original", label: t("reader.mode.original") },
    { value: "parallel", label: t("reader.mode.parallel") },
    { value: "translated", label: t("reader.mode.translated") },
  ];
  return (
    <SegmentedControl
      kind="radio"
      label={t("reader.mode.label")}
      size="sm"
      value={mode}
      options={options}
      onChange={onChange}
    />
  );
}
