import { useI18n } from "../../i18n/I18nProvider";
import type { MenuEntry } from "../../ui";
import type { ReadingMode, TranslationLanguage } from "./mode";
import { resolveModel, useTranslationSettings } from "./useTranslationSettings";

export interface ModeEntriesArgs {
  language: TranslationLanguage;
  onLanguage(language: TranslationLanguage): void;
  /** The model asked for; `null` is the one the settings have chosen. */
  modelId: string | null;
  onModel(id: string): void;
  /** Only given where there is a page to translate again (the side-by-side view). */
  onRetranslatePage?(): void;
  /** Where the menu carries the reading modes too (a strip too narrow for the switch): the chosen one, and the way to change it. */
  modes?: { mode: ReadingMode; onChange(mode: ReadingMode): void };
}

/** A menu item has no checked state: the chosen one says so in its label, and the others keep its room. */
const CHOSEN = "✓ ";
const NOT_CHOSEN = "   ";

const mark = (chosen: boolean, label: string) =>
  (chosen ? CHOSEN : NOT_CHOSEN) + label;

const MODES: ReadingMode[] = ["original", "parallel", "translated"];

/**
 * The entries of the translation menu: the reading modes (where asked for),
 * the language to translate into, the model to translate with, and (side by
 * side) translating the page again. The more menu of a strip with no room even
 * for the one button holds them as well.
 */
export function useModeEntries({
  language,
  onLanguage,
  modelId,
  onModel,
  onRetranslatePage,
  modes,
}: ModeEntriesArgs): MenuEntry[] {
  const { t } = useI18n();
  const settings = useTranslationSettings();
  const current = resolveModel(settings, modelId);

  return [
    ...(modes
      ? ([
          ...MODES.map(
            (mode): MenuEntry => ({
              id: `mode-${mode}`,
              label: mark(mode === modes.mode, t(`reader.mode.${mode}`)),
              onSelect: () => modes.onChange(mode),
            }),
          ),
          { kind: "separator", id: "modes" },
        ] satisfies MenuEntry[])
      : []),
    {
      id: "language-zh",
      label: mark(language === "zh", t("reader.translation.toChinese")),
      onSelect: () => onLanguage("zh"),
    },
    {
      id: "language-en",
      label: mark(language === "en", t("reader.translation.toEnglish")),
      onSelect: () => onLanguage("en"),
    },
    { kind: "separator", id: "models" },
    ...(settings.models.length
      ? settings.models.map(
          (model): MenuEntry => ({
            id: `model-${model.id}`,
            label: mark(model.id === current, model.name || model.model),
            onSelect: () => onModel(model.id),
          }),
        )
      : // Nothing to choose from yet (or not heard yet): the way to add one.
        settings.loaded
        ? [
            {
              id: "add-model",
              label: t("reader.translation.addModel"),
              onSelect: () => {
                window.location.hash = "settings";
              },
            } satisfies MenuEntry,
          ]
        : []),
    ...(onRetranslatePage
      ? ([
          { kind: "separator", id: "page" },
          {
            id: "retranslate",
            label: t("reader.translation.retranslate"),
            onSelect: onRetranslatePage,
          },
        ] satisfies MenuEntry[])
      : []),
  ];
}
