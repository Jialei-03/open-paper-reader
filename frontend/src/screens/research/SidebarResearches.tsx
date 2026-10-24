import { Plus } from "lucide-react";
import { useContext } from "react";
import { AppActions } from "../../app/AppSidebar";
import { parseAppRoute } from "../../app/routes";
import { sidebarId } from "../../app/sidebar-entries";
import {
  MESSAGE_FIRST,
  pageRows,
  sidebarPageKey,
  SidebarPagination,
  useSidebarPage,
} from "../../app/sidebar-pagination";
import { useI18n } from "../../i18n/I18nProvider";
import { followLink } from "../../reader/route";
import { IconButton, Spinner } from "../../ui";
import type { NavigationResearch } from "./navigation-api";
import { useResearchNavigation } from "./ResearchNavigation";
import { statusOf } from "./status";
import nav from "./TeamNavigation.module.css";

/**
 * The current project's researches, as Claude lists conversations: one line
 * each, latest first, with a single state at its end — a spinner while it
 * runs, "waiting" when it needs the researcher.
 */
export function SidebarResearches({
  workspaceId,
  hash,
  go,
}: {
  workspaceId: string;
  hash: string;
  go(hash: string): void;
}) {
  const { t } = useI18n();
  const { owner = "" } = useContext(AppActions);
  const { data } = useResearchNavigation();
  const [limit, choose] = useSidebarPage(
    sidebarPageKey(owner, workspaceId, "researches"),
    MESSAGE_FIRST,
  );
  const route = parseAppRoute(hash);
  const currentId =
    route.screen === "research"
      ? route.projectId
      : route.screen === "team" && route.threadId?.startsWith("research:")
        ? route.threadId.slice("research:".length)
        : undefined;
  const researches = (
    data.workspaces.find((w) => w.id === workspaceId)?.researches || []
  )
    .filter((r) => !r.archived_at)
    .sort(
      (a, b) =>
        (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0),
    );
  const waiting = (r: NavigationResearch) => statusOf(r).tone === "review";
  const { rows, hidden } = pageRows(
    researches,
    limit,
    (r) => r.id === currentId || !!r.working || waiting(r),
  );
  const newHash = `new?workspace=${workspaceId}`;
  return (
    <section
      data-sidebar-place="researches"
      aria-labelledby="sidebar-researches"
    >
      <div className={nav.heading}>
        <span id="sidebar-researches">{t("sidebar.researches")}</span>
        <IconButton
          data-id={sidebarId("research-new")}
          icon={Plus}
          label={t("projects.newResearch")}
          onClick={() => go(newHash)}
        />
      </div>
      <div className={nav.researchList}>
        {rows.map((r) => {
          const target = `research/${r.id}`;
          return (
            <a
              key={r.id}
              className={nav.researchRow}
              data-id={sidebarId("research-row")}
              href={`#${target}`}
              title={r.question}
              aria-current={r.id === currentId ? "page" : undefined}
              onClick={followLink(go, target)}
            >
              <span>{r.title || r.question}</span>
              {r.working ? (
                <span
                  className={nav.researchState}
                  role="img"
                  aria-label={t("research.status.running")}
                >
                  <Spinner size={14} />
                </span>
              ) : waiting(r) ? (
                <small>{t("sidebar.waiting")}</small>
              ) : r.unread ? (
                <span
                  className={nav.researchDot}
                  role="img"
                  aria-label={t("research.unread")}
                />
              ) : null}
            </a>
          );
        })}
        <SidebarPagination
          list="researches"
          first={MESSAGE_FIRST}
          limit={limit}
          hidden={hidden}
          choose={choose}
        />
      </div>
    </section>
  );
}
