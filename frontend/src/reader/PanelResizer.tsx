import { useI18n } from "../i18n/I18nProvider";
import { Resizer, useResizableWidth } from "../ui/Resizer";

/** The docked panel's width: where it starts, and the least and most it can be. */
export const PANEL_DEFAULT = 400;
export const PANEL_MIN = 300;
const PANEL_MAX = 720;

/** The most the panel can be in a window this wide: the paper's card keeps at least half. */
export const panelMax = (windowWidth: number) =>
  Math.max(PANEL_MIN, Math.min(PANEL_MAX, Math.floor(windowWidth / 2)));

/**
 * The docked panel's width, kept per user on this device. What was chosen is
 * kept as it was; a window too small for it shows it narrower, and a larger one
 * gives it back.
 */
export function usePanelWidth(owner: string) {
  return useResizableWidth({
    key: `paper-panel-width:${owner}`,
    fallback: PANEL_DEFAULT,
    min: PANEL_MIN,
    maxFor: panelMax,
  });
}

/**
 * The handle on the docked panel's left edge, in the gap between the paper's
 * card and the panel (the panel is its next sibling). Dragging it, or the arrow
 * keys, changes the panel's width; a double click puts it back to 400px.
 */
export function PanelResizer({
  width,
  max,
  onChange,
}: {
  width: number;
  max: number;
  onChange: (width: number) => void;
}) {
  const { t } = useI18n();
  return (
    <Resizer
      sizes="next"
      width={width}
      min={PANEL_MIN}
      max={max}
      fallback={PANEL_DEFAULT}
      maxNow={() => panelMax(window.innerWidth)}
      property="--panel-width"
      label={t("reader.panel.resize")}
      onChange={onChange}
    />
  );
}
