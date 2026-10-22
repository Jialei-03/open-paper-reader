import {
  BookCheck,
  BookOpen,
  Circle,
  Compass,
  FileText,
  LayoutGrid,
  Library,
  Plus,
  Settings2,
  Sparkles,
} from "lucide-react";
import { useI18n } from "../i18n/I18nProvider";
import { followLink, readerHash } from "../reader/route";
import { SidebarItem, SidebarSection } from "../ui";
import { useResearchNavigation } from "../screens/research/ResearchNavigation";
import type { AppRoute } from "./routes";
import type { LocalSection } from "./local-sections";
import styles from "./AppSidebar.module.css";

/** Each app section owns its secondary navigation. */
export function SectionNavigation({
  section,
  route,
  hash,
  reading,
  go,
}: {
  section: LocalSection;
  route: AppRoute;
  hash: string;
  reading: { id: string; title: string }[];
  go(hash: string): void;
}) {
  const { t } = useI18n();
  const { data } = useResearchNavigation();
  const view =
    new URLSearchParams(hash.split("?")[1] || "").get("view") || "all";
  const importParams = new URLSearchParams(
    route.screen === "library" ? hash.split("?")[1] || "" : "",
  );
  importParams.set("import", "1");
  const item = (
    Icon: typeof Library,
    label: string,
    path: string,
    active = false,
  ) => (
    <SidebarItem
      key={path}
      icon={Icon}
      label={label}
      href={`#${path}`}
      active={active}
      onClick={followLink(go, path)}
    />
  );
  if (section === "materials")
    return (
      <>
        <div className={styles.researchActions}>
          {item(Plus, t("library.import"), `library?${importParams}`)}
        </div>
        <div className={styles.sectionLinks}>
          {item(
            Library,
            t("library.filter.all"),
            "library",
            route.screen === "library" && view === "all",
          )}
          {item(
            BookOpen,
            t("library.status.reading"),
            "library?view=reading",
            route.screen === "library" && view === "reading",
          )}
          {item(
            Circle,
            t("library.status.unread"),
            "library?view=unread",
            route.screen === "library" && view === "unread",
          )}
          {item(
            BookCheck,
            t("library.status.read"),
            "library?view=read",
            route.screen === "library" && view === "read",
          )}
          {item(
            Compass,
            t("app.discover"),
            "discover",
            route.screen === "discover",
          )}
        </div>
        {!!reading.length && (
          <div className={styles.sectionGroup}>
            <SidebarSection title={t("app.section.recent")}>
              {reading.map(({ id, title }) => {
                const path = readerHash({ paperId: id }).slice(1);
                return item(
                  FileText,
                  title,
                  path,
                  route.screen === "reader" && route.reader.paperId === id,
                );
              })}
            </SidebarSection>
          </div>
        )}
      </>
    );
  if (section === "customize")
    return (
      <div
        className={styles.sectionLinks}
        aria-label={t("customize.navigation")}
      >
        {item(
          Settings2,
          t("customize.playbook"),
          "customize/playbook",
          route.screen === "customize" && route.section === "playbook",
        )}
        {item(
          Sparkles,
          t("customize.models"),
          "customize/models",
          route.screen === "customize" && route.section === "models",
        )}
      </div>
    );
  if (section === "board") {
    const rows = data.workspaces
      .filter((w) => !w.archived)
      .flatMap((w) => w.researches)
      .filter((r) => r.on_board);
    return (
      <>
        {item(LayoutGrid, t("projects.view.board"), "board", true)}
        <div className={styles.sectionGroup}>
          <SidebarSection title={t("app.section.selected")}>
            {rows.map((row) =>
              item(FileText, row.title || row.question, `research/${row.id}`),
            )}
            {!rows.length && (
              <p className={styles.sectionHint}>{t("app.section.boardHint")}</p>
            )}
          </SidebarSection>
        </div>
      </>
    );
  }
  return null;
}
