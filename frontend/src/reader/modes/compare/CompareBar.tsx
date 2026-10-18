import { ArrowLeftRight, Link2 } from "lucide-react";
import { useI18n } from "../../../i18n/I18nProvider";
import { IconButton, SegmentedControl } from "../../../ui";
import styles from "./CompareBar.module.css";
import type { TranslatedView } from "./view-preference";

/** In a card too narrow for two pages: which of the two is shown. */
export type Side = "original" | "translated";

export interface CompareBarProps {
  /** Room for two pages: the choice is between the translation alone and the two side by side. */
  wide: boolean;
  view: TranslatedView;
  onView(view: TranslatedView): void;
  /** Narrow: the one shown. */
  side: Side;
  onSide(side: Side): void;
  /** Side by side only: scrolling one pane moves the other. */
  linked: boolean;
  onLinked(linked: boolean): void;
  swapped: boolean;
  onSwap(): void;
  /** Side by side: whether the places are matched by the job's alignment, or by the pages' proportion. */
  aligned: boolean;
}

/**
 * The strip under the card's header when the translated PDF is read: how it is
 * shown (alone, or beside the original), and, side by side, the tools of the
 * two panes. Where the card has no room for two pages, a switch between them.
 */
export function CompareBar({
  wide,
  view,
  onView,
  side,
  onSide,
  linked,
  onLinked,
  swapped,
  onSwap,
  aligned,
}: CompareBarProps) {
  const { t } = useI18n();
  const together = wide && view === "compare";
  return (
    <div className={styles.bar} data-testid="compare-bar">
      {wide ? (
        <SegmentedControl
          kind="radio"
          size="sm"
          label={t("reader.compare.view")}
          value={view}
          options={[
            { value: "only", label: t("reader.compare.only") },
            { value: "compare", label: t("reader.compare.side") },
          ]}
          onChange={onView}
        />
      ) : (
        <SegmentedControl
          kind="radio"
          size="sm"
          label={t("reader.compare.switch")}
          value={side}
          options={[
            { value: "original", label: t("reader.compare.original") },
            { value: "translated", label: t("reader.compare.translated") },
          ]}
          onChange={onSide}
        />
      )}
      {together && (
        <>
          <span className={styles.basis}>
            {t(aligned ? "reader.compare.aligned" : "reader.compare.byPages")}
          </span>
          <div className={styles.tools}>
            <IconButton
              icon={Link2}
              label={t("reader.compare.link")}
              aria-pressed={linked}
              variant={linked ? "secondary" : "ghost"}
              onClick={() => onLinked(!linked)}
            />
            <IconButton
              icon={ArrowLeftRight}
              label={t("reader.compare.swap")}
              aria-pressed={swapped}
              onClick={onSwap}
            />
          </div>
        </>
      )}
    </div>
  );
}
