import {
  FileText,
  House,
  Library,
  LogOut,
  Search,
  Settings,
} from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Paper } from "../api";
import { useI18n } from "../i18n/I18nProvider";
import { followLink, readerHash } from "../reader/route";
import {
  ariaKeyShortcuts,
  currentPlatformIsMac,
  formatShortcut,
  Kbd,
  Sidebar,
  SidebarItem,
  SidebarSection,
} from "../ui";
import type { AppScreen } from "./routes";
import styles from "./AppSidebar.module.css";

/** Opens quick open, from anywhere in the app. */
export const QUICK_OPEN_SHORTCUT = "mod+k";

/** How many of the papers read last the sidebar lists. */
const READING_LIMIT = 5;

/**
 * What the app around a screen offers its sidebar: quick open and signing out.
 * A screen drawn outside the app (a test, the kit) has neither, and the sidebar
 * then leaves those items out.
 */
export const AppActions = createContext<{
  /** The person signed in. */
  owner?: string;
  quickOpen?: () => void;
  signOut?: () => void;
}>({});

export interface AppSidebarProps {
  /**
   * The window is too narrow for the sidebar beside the cards: it is a rail of
   * icons whatever was chosen on a wide window, and opened it floats over the
   * cards (closing again when something else is done).
   */
  floating: boolean;
  /** The screen that is showing; for the reader, `paperId` says which paper. */
  screen: AppScreen;
  /** The paper being read, when `screen` is the reader. */
  paperId?: string;
  papers: Paper[];
  /** The paper being read, once it has loaded (named from itself until the list has caught up with it). */
  current?: Paper | null;
  /** When each paper was last opened on this device, by id. */
  visits: Record<string, number>;
  /** Takes an address without its `#`. */
  go: (hash: string) => void;
}

/**
 * The app's navigation, the same on every screen and in the reader: home, the
 * library, the papers read last (the one being read marked), and the settings.
 */
export function AppSidebar({
  floating,
  screen,
  paperId = "",
  papers,
  current = null,
  visits,
  go,
}: AppSidebarProps) {
  const { t } = useI18n();
  const { quickOpen, signOut } = useContext(AppActions);
  // Two answers, one for each kind of window: what was chosen on a wide one is not lost on a narrow one.
  const [collapsed, setCollapsed] = useState(false);
  const [opened, setOpened] = useState(false);
  // Whichever way the window has changed, the sidebar floats shut (a wide one keeps what was chosen).
  useEffect(() => setOpened(false), [floating]);

  const reading = useMemo(() => {
    const titles = new Map(papers.map((paper) => [paper.id, paper.title]));
    if (current) titles.set(current.id, current.title);
    const ids = Object.entries(visits)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
    // Remembered once it has loaded; until then it is still the one being read.
    if (paperId && titles.has(paperId) && !ids.includes(paperId))
      ids.unshift(paperId);
    return ids
      .filter((id) => titles.has(id))
      .slice(0, READING_LIMIT)
      .map((id) => ({ id, title: titles.get(id) || t("reader.untitled") }));
  }, [papers, current, visits, paperId, t]);

  const reader = screen === "reader";
  // Only the icons are left of a rail: the search is then an item like the others.
  const rail = floating ? !opened : collapsed;
  return (
    <Sidebar
      label={t("reader.region.sidebar")}
      collapsed={floating ? !opened : collapsed}
      onCollapsedChange={(shut) =>
        floating ? setOpened(!shut) : setCollapsed(shut)
      }
      overlay={floating}
      footer={
        <>
          <SidebarItem
            icon={Settings}
            label={t("reader.sidebar.settings")}
            href="#settings"
            active={screen === "settings"}
            onClick={followLink(go, "settings")}
          />
          {signOut && (
            <SidebarItem
              icon={LogOut}
              label={t("app.signOut")}
              onClick={signOut}
            />
          )}
        </>
      }
    >
      <SidebarSection>
        {quickOpen &&
          (rail ? (
            <SidebarItem
              icon={Search}
              label={t("app.quickOpen")}
              meta={formatShortcut(QUICK_OPEN_SHORTCUT, currentPlatformIsMac())}
              onClick={quickOpen}
            />
          ) : (
            <button
              type="button"
              className={styles.search}
              aria-keyshortcuts={ariaKeyShortcuts(
                QUICK_OPEN_SHORTCUT,
                currentPlatformIsMac(),
              )}
              onClick={() => {
                quickOpen();
                if (floating) setOpened(false);
              }}
            >
              <Search size={15} aria-hidden="true" />
              <span className={styles.placeholder}>{t("app.quickOpen")}</span>
              <Kbd shortcut={QUICK_OPEN_SHORTCUT} />
            </button>
          ))}
        <SidebarItem
          icon={House}
          label={t("app.home")}
          href="#home"
          active={screen === "home"}
          onClick={followLink(go, "home")}
        />
        <SidebarItem
          icon={Library}
          label={t("reader.sidebar.library")}
          href="#library"
          active={screen === "library"}
          onClick={followLink(go, "library")}
        />
      </SidebarSection>
      {reading.length > 0 && (
        <SidebarSection title={t("reader.sidebar.reading")}>
          {reading.map(({ id, title }) => {
            const hash = readerHash({ paperId: id });
            const here = reader && id === paperId;
            return (
              <SidebarItem
                key={id}
                icon={FileText}
                label={title}
                href={hash}
                active={here}
                dot={here}
                onClick={followLink(go, hash.slice(1))}
              />
            );
          })}
        </SidebarSection>
      )}
    </Sidebar>
  );
}
