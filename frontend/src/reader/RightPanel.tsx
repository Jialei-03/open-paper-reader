import clsx from "clsx";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { Paper, SourceFile } from "../api";
import { useI18n } from "../i18n/I18nProvider";
import { Card, CardHeader, SegmentedControl } from "../ui";
import { GuideTab } from "./panel/GuideTab";
import type { Keypoints } from "./keypoints";
import { NotesTab, type NotesTabProps } from "./panel/NotesTab";
import { AssistantThread, type Assistant } from "./assistant";
import type { ReaderRoute } from "./route";
import { RelatedTab } from "./related/RelatedTab";
import { RegionBoundary } from "./RegionBoundary";
import styles from "./RightPanel.module.css";

/** The panel's views, one shown at a time. */
export type PanelView = "assistant" | "notes" | "related";

const VIEWS = [
  "assistant",
  "notes",
  "related",
] as const satisfies readonly PanelView[];

/** In a window too narrow for it beside the paper, the panel floats over the paper instead. */
export interface PanelOverlay {
  open: boolean;
  /** Esc asks for this. */
  onClose: () => void;
  /** Where the keyboard goes back to when the panel closes (the button that opens it). */
  returnFocus: RefObject<HTMLElement | null>;
}

/** The foot of the panel, where the assistant's question box docks (under every view). */
export interface PanelDock {
  /** The foot's element: where the screen tells the panel from the paper when the box is dragged. */
  footRef: RefObject<HTMLDivElement | null>;
  /** The box, when it is docked; nothing while it floats over the paper. */
  children: ReactNode;
  /** The box is being dragged: the panel shows where it would land, and says so when the pointer is over it. */
  drop?: "away" | "over";
}

/**
 * The card beside the paper: a guide to it, the assistant, and the notes, one at
 * a time (until the paper is there, each says what it will hold). Docked it is
 * always there, 400px wide. With `overlay` it is folded away until `overlay.open`, and then floats
 * over the paper from the right edge, below the paper's header (so the button
 * that opens it stays in reach); Esc closes it.
 */
export function RightPanel({
  overlay,
  collapsed = false,
  paper,
  file,
  onJumpToPage,
  assistant,
  keypoints,
  onCite,
  onKeep,
  notes,
  tab,
  onTabChange,
  dock,
  guideAsk = 0,
}: {
  /** What the panel is about. The views are not made from it yet. */
  paperId: string;
  /** The paper and its PDF, once they are loaded. */
  paper?: Paper | null;
  file?: SourceFile | null;
  /** A page named in the panel (the guide's page chips) was pressed. */
  onJumpToPage?: (page: number) => void;
  overlay?: PanelOverlay;
  /** Docked and put away by the reader (the paper takes the room); kept mounted, out of reach. */
  collapsed?: boolean;
  assistant?: Assistant;
  /** The key sentences, listed in the guide. */
  keypoints?: Keypoints;
  onCite?: (route: ReaderRoute) => void;
  /** A guide section or an answer was kept in the note (its Markdown, citations included). */
  onKeep?: (markdown: string) => void;
  /** What the notes tab is made from; until the paper is there, the tab says what it will hold. */
  notes?: NotesTabProps;
  /** The view shown, when the screen chooses it (to show the answer it asked for); else the panel keeps its own. */
  tab?: PanelView;
  /** A tab was chosen. */
  onTabChange?: (tab: PanelView) => void;
  /** The question box's place under the views. */
  dock?: PanelDock;
  /** Counts the requests to see the guide (the opening block of the assistant's view): each scrolls to it. */
  guideAsk?: number;
}) {
  const { t } = useI18n();
  const ids = useId();
  const [own, setOwn] = useState<PanelView>("assistant");
  const view = tab ?? own;
  const choose = (next: PanelView) => {
    setOwn(next);
    onTabChange?.(next);
  };
  const tabs = useRef<HTMLDivElement>(null);
  const guideEl = useRef<HTMLDivElement>(null);
  const asked = useRef(guideAsk);
  useEffect(() => {
    if (guideAsk === asked.current) return;
    asked.current = guideAsk;
    guideEl.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [guideAsk]);

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
        !floating && collapsed && styles.collapsed,
      )}
      inert={!floating && collapsed ? true : undefined}
      aria-hidden={!floating && collapsed ? true : undefined}
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
              onChange={choose}
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
              {value === "assistant" && onCite ? (
                <div className={styles.stack}>
                  <div ref={guideEl} className={styles.guide}>
                    {paper && file && onJumpToPage ? (
                      <GuideTab
                        key={file.id}
                        paper={paper}
                        file={file}
                        onJumpToPage={onJumpToPage}
                        onCite={onCite}
                        onKeep={onKeep}
                        keypoints={keypoints}
                        onJumpKeypoint={(item) =>
                          onCite({
                            paperId: paper.id,
                            fileId: file.id,
                            page: item.page,
                            quote: item.quote,
                          })
                        }
                      />
                    ) : (
                      <p className={styles.placeholder}>
                        {t("reader.tab.assistant.empty")}
                      </p>
                    )}
                  </div>
                  {assistant && (
                    <AssistantThread
                      assistant={assistant}
                      onCite={onCite}
                      fileId={file?.id}
                      onKeep={onKeep}
                    />
                  )}
                </div>
              ) : value === "notes" && notes ? (
                <NotesTab {...notes} />
              ) : value === "related" && paper ? (
                <RelatedTab paper={paper} active={view === "related"} />
              ) : (
                <p className={styles.placeholder}>
                  {t(`reader.tab.${value}.empty`)}
                </p>
              )}
            </div>
          ))}
        </div>
        {dock && (
          <div ref={dock.footRef} className={styles.dock}>
            {dock.children}
          </div>
        )}
        {dock?.drop && (
          <div className={styles.drop} data-over={dock.drop === "over"}>
            {t("reader.assistant.dock.drop")}
          </div>
        )}
      </RegionBoundary>
    </Card>
  );
}
