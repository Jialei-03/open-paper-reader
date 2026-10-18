import { ChevronDown, Languages } from "lucide-react";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, IconButton, Menu, Tooltip } from "../../ui";
import styles from "./TranslationMenu.module.css";
import { useModeEntries, type ModeEntriesArgs } from "./useModeEntries";

export type TranslationMenuProps = ModeEntriesArgs;

/**
 * The small menu beside the reading mode: what language to translate into,
 * which of the models to translate with, and (side by side) translating the
 * page again. In a strip too narrow for the switch it carries the reading
 * modes too (`modes`), and its button says which one is chosen.
 */
export function TranslationMenu(props: TranslationMenuProps) {
  const { t } = useI18n();
  const items = useModeEntries(props);
  const { modes } = props;

  return (
    <Menu
      label={t("reader.translation.menu")}
      placement={{ side: "bottom", align: "end" }}
      items={items}
      trigger={(trigger) =>
        modes ? (
          <Tooltip content={t("reader.translation.menu")}>
            <Button
              {...trigger}
              size="sm"
              variant="ghost"
              icon={Languages}
              aria-label={t("reader.mode.current", {
                mode: t(`reader.mode.${modes.mode}`),
              })}
            >
              <span className={styles.current}>
                {t(`reader.mode.${modes.mode}`)}
                <ChevronDown size={14} aria-hidden="true" />
              </span>
            </Button>
          </Tooltip>
        ) : (
          <IconButton
            {...trigger}
            icon={Languages}
            label={t("reader.translation.menu")}
          />
        )
      }
    />
  );
}
