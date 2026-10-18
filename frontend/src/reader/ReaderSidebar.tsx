import { FileText, Library, Settings } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Paper } from "../api";
import { useI18n } from "../i18n/I18nProvider";
import { Sidebar, SidebarItem, SidebarSection } from "../ui";
import { followLink, readerHash } from "./route";

/** How many of the papers read last the sidebar lists. */
const READING_LIMIT = 5;

/**
 * The reader's navigation: back to the library, the papers read last (this one
 * marked), and the settings. The papers are those this device remembers
 * (`visits`: when each was last opened), named from the library's list; the
 * paper being read is named from itself until the list has caught up with it.
 */
export function ReaderSidebar({
  floating,
  paperId,
  papers,
  current,
  visits,
  go,
}: {
  /**
   * The window is too narrow for the sidebar beside the paper: it is a rail of
   * icons whatever was chosen on a wide window, and opened it floats over the
   * paper (closing again when something else is done).
   */
  floating: boolean;
  paperId: string;
  papers: Paper[];
  /** This paper, once it has loaded. */
  current: Paper | null;
  /** When each paper was last opened on this device, by id. */
  visits: Record<string, number>;
  /** Takes an address without its `#`, as everywhere in the workspace. */
  go: (hash: string) => void;
}) {
  const { t } = useI18n();
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
    if (titles.has(paperId) && !ids.includes(paperId)) ids.unshift(paperId);
    return ids
      .filter((id) => titles.has(id))
      .slice(0, READING_LIMIT)
      .map((id) => ({ id, title: titles.get(id) || t("reader.untitled") }));
  }, [papers, current, visits, paperId, t]);

  return (
    <Sidebar
      label={t("reader.region.sidebar")}
      collapsed={floating ? !opened : collapsed}
      onCollapsedChange={(shut) =>
        floating ? setOpened(!shut) : setCollapsed(shut)
      }
      overlay={floating}
      footer={
        <SidebarItem
          icon={Settings}
          label={t("reader.sidebar.settings")}
          href="#settings"
          onClick={followLink(go, "settings")}
        />
      }
    >
      <SidebarSection>
        <SidebarItem
          icon={Library}
          label={t("reader.sidebar.library")}
          href="#library"
          onClick={followLink(go, "library")}
        />
      </SidebarSection>
      {reading.length > 0 && (
        <SidebarSection title={t("reader.sidebar.reading")}>
          {reading.map(({ id, title }) => {
            const hash = readerHash({ paperId: id });
            return (
              <SidebarItem
                key={id}
                icon={FileText}
                label={title}
                href={hash}
                active={id === paperId}
                dot={id === paperId}
                onClick={followLink(go, hash.slice(1))}
              />
            );
          })}
        </SidebarSection>
      )}
    </Sidebar>
  );
}
