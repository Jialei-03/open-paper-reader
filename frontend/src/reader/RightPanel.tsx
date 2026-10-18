import clsx from "clsx";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { Paper, SourceFile } from "../api";
import { useI18n } from "../i18n/I18nProvider";
import { Card, CardHeader, SegmentedControl } from "../ui";
import { GuideTab } from "./panel/GuideTab";
import { AssistantThread, type Assistant } from "./assistant";
import type { ReaderRoute } from "./route";
import { RegionBoundary } from "./RegionBoundary";
import styles from "./RightPanel.module.css";

type View = "guide" | "assistant" | "notes";

const VIEWS = [
  "guide",
  "assistant",
  "notes",
] as const satisfies readonly View[];

/** In a window too narrow for it beside the paper, the panel floats over the paper instead. */
export interface PanelOverlay {
  open: boolean;
  /** Esc asks for this. */
  onClose: () => void;
  /** Where the keyboard goes back to when the panel closes (the button that opens it). */
  returnFocus: RefObject<HTMLElement | null>;
}

/**
 * The card beside the paper: a guide to it, the assistant, and the notes, one at
 * a time. The three are placeholders for now. Docked it is always there, 400px
 * wide. With `overlay` it is folded away until `overlay.open`, and then floats
 * over the paper from the right edge, below the paper's header (so the button
 * that opens it stays in reach); Esc closes it.
 */
export function RightPanel({
  overlay,
  paper,
  file,
  onJumpToPage,
  assistant,
  onCite,
}: {
  /** What the panel is about. The views are not made from it yet. */
  paperId: string;
  /** The paper and its PDF, once they are loaded. */
  paper?: Paper | null;
  file?: SourceFile | null;
  /** A page named in the panel (the guide's page chips) was pressed. */
  onJumpToPage?: (page: number) => void;
  overlay?: PanelOverlay;
  assistant?: Assistant;
  onCite?: (route: ReaderRoute) => void;
}) {
  const { t } = useI18n();
  const ids = useId();
  const [view, setView] = useState<View>("guide");
  const tabs = useRef<HTMLDivElement>(null);

  const floating = overlay !== undefined;
  const shown = overlay?.open === true;
  const onClose = overlay?.onClose;
  const returnFocus = overlay?.returnFocus;

  // Opening puts the keyboard on the tabs; closing gives it back to the button.
  const wasShown = useRef(false);
  useEffect(() => {
    if (shown && !wasShown.current)
      tabs.current
        ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
        ?.focus();
    // A window that grows wide closes the overlay without anyone leaving it: the focus stays put.
    else if (!shown && wasShown.current && floating)
      returnFocus?.current?.focus();
    wasShown.current = shown;
  }, [shown, floating, returnFocus]);

  useEffect(() => {
    if (!shown || !onClose) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing)
        return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shown, onClose]);

  return (
    <Card
      as="aside"
      aria-label={t("reader.region.panel")}
      className={clsx(
        styles.panel,
        floating && styles.floating,
        floating && !shown && styles.folded,
      )}
    >
      <RegionBoundary region="panel">
        <CardHeader>
          <div ref={tabs}>
            <SegmentedControl
              kind="tabs"
              size="sm"
              label={t("reader.panel.tabs")}
              options={VIEWS.map((value) => ({
                value,
                label: t(`reader.tab.${value}`),
                panelId: `${ids}-${value}`,
              }))}
              value={view}
              onChange={setView}
            />
          </div>
        </CardHeader>
        <div className={styles.body}>
          {VIEWS.map((value) => (
            <div
              key={value}
              role="tabpanel"
              id={`${ids}-${value}`}
              aria-labelledby={`${ids}-${value}-tab`}
              hidden={view !== value}
            >
              {value === "guide" && paper && file && onJumpToPage ? (
                <GuideTab
                  key={file.id}
                  paper={paper}
                  file={file}
                  onJumpToPage={onJumpToPage}
                />
              ) : value === "assistant" && assistant && onCite ? (
                <AssistantThread assistant={assistant} onCite={onCite} />
              ) : (
                <p className={styles.placeholder}>
                  {t(`reader.tab.${value}.empty`)}
                </p>
              )}
            </div>
          ))}
        </div>
      </RegionBoundary>
    </Card>
  );
}
