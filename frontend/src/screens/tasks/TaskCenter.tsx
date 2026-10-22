import {
  ArrowUpRight,
  CheckCheck,
  CircleDot,
  CircleHelp,
  Clock3,
  Monitor,
  Pause,
  Server,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/i18n";
import { followLink } from "../../reader/route";
import { Button, Spinner, TextField } from "../../ui";
import { useResearchNavigation } from "../research/ResearchNavigation";
import type {
  NavigationResearch,
  NavigationWorkspace,
} from "../research/navigation-api";
import { researchStatus } from "../research/navigation-status";
import type { ResearchSummary } from "../research/research-api";
import { workspaceMachine } from "../research/workspace-machine";
import styles from "./TaskCenter.module.css";

export type TaskFilter = "active" | "waiting" | "paused" | "history";

const FILTERS: TaskFilter[] = ["active", "waiting", "paused", "history"];
const ICONS = {
  active: CircleDot,
  waiting: CircleHelp,
  paused: Pause,
  history: CheckCheck,
};

/** Idle conversations remain chats; tasks represent work or an outstanding decision. */
export function researchTaskFilter(
  research: ResearchSummary,
): TaskFilter | null {
  switch (researchStatus(research)) {
    case "research.status.running":
      return "active";
    case "research.status.waiting":
      return "waiting";
    case "research.status.paused":
      return "paused";
    case "research.status.finished":
    case "research.status.stopped":
      return "history";
    default:
      return null;
  }
}

interface TaskRow {
  research: NavigationResearch;
  workspace: NavigationWorkspace;
}

function allTasks(workspaces: NavigationWorkspace[]): TaskRow[] {
  return workspaces
    .flatMap((workspace) =>
      workspace.researches.map((research) => ({ research, workspace })),
    )
    .filter(({ research }) => researchTaskFilter(research) !== null)
    .sort((a, b) => b.research.updated_at.localeCompare(a.research.updated_at));
}

const taskPath = (filter: TaskFilter, id: string) =>
  `tasks/${filter}?research=${encodeURIComponent(id)}`;

/** Secondary navigation for real research tasks across all workspaces. */
export function TaskNavigation({
  filter,
  go,
  currentId,
}: {
  filter: TaskFilter;
  go(hash: string): void;
  currentId?: string;
}) {
  const { t } = useI18n();
  const { data, connections, ready, error, reload } = useResearchNavigation();
  const rows = useMemo(() => allTasks(data.workspaces), [data.workspaces]);
  const visible = rows.filter(
    ({ research }) => researchTaskFilter(research) === filter,
  );

  return (
    <nav className={styles.navigation} aria-label={t("tasks.navigation")}>
      <div className={styles.filters}>
        {FILTERS.map((value) => {
          const Icon = ICONS[value];
          const count = rows.filter(
            ({ research }) => researchTaskFilter(research) === value,
          ).length;
          return (
            <a
              key={value}
              href={`#tasks/${value}`}
              onClick={followLink(go, `tasks/${value}`)}
              aria-current={filter === value && !currentId ? "page" : undefined}
              data-selected={filter === value || undefined}
            >
              <Icon size={16} aria-hidden />
              <span>{t(`tasks.filter.${value}` as MessageKey)}</span>
              <small>{count}</small>
            </a>
          );
        })}
      </div>
      <div className={styles.researches}>
        {!ready && !error && <Spinner />}
        {error && (
          <div className={styles.feedback}>
            <p role="alert">{error}</p>
            <Button size="sm" variant="ghost" onClick={reload}>
              {t("common.retry")}
            </Button>
          </div>
        )}
        {visible.map(({ research, workspace }) => {
          const path = taskPath(filter, research.id);
          const machine = workspaceMachine(
            workspace.location,
            connections,
            t("workspace.local"),
            t("workspace.remote"),
          );
          return (
            <a
              key={research.id}
              href={`#${path}`}
              onClick={followLink(go, path)}
              aria-current={research.id === currentId ? "page" : undefined}
              title={research.title || research.question}
            >
              <span>{research.title || research.question}</span>
              <small title={machine.title}>
                {workspace.name} · {machine.label}
              </small>
            </a>
          );
        })}
        {ready && !error && !visible.length && (
          <p className={styles.navigationEmpty}>
            {t(`tasks.empty.${filter}` as MessageKey)}
          </p>
        )}
      </div>
    </nav>
  );
}

/** A task is an existing research, never a separate scheduler or copied conversation. */
export function TaskCenter({
  filter = "active",
  go,
}: {
  filter?: TaskFilter;
  go(hash: string): void;
}) {
  const { t, locale } = useI18n();
  const { data, connections, ready, error, reload } = useResearchNavigation();
  const [search, setSearch] = useState("");
  const rows = useMemo(() => allTasks(data.workspaces), [data.workspaces]);
  const query = search.trim().toLocaleLowerCase();
  const visible = rows.filter(({ research, workspace }) => {
    if (researchTaskFilter(research) !== filter) return false;
    const machine = workspaceMachine(
      workspace.location,
      connections,
      t("workspace.local"),
      t("workspace.remote"),
    );
    return `${research.title || ""} ${research.question} ${workspace.name} ${machine.label}`
      .toLocaleLowerCase()
      .includes(query);
  });
  const emptyState = ready && !error && !query && !visible.length;

  return (
    <section className={styles.page} aria-labelledby="task-center-title">
      <div className={styles.content}>
        {emptyState ? (
          <div className={styles.emptyState}>
            <Clock3 size={44} strokeWidth={1.25} aria-hidden />
            <h1 id="task-center-title">
              {t(`tasks.empty.${filter}` as MessageKey)}
            </h1>
            <p>{t("tasks.description")}</p>
            <Button variant="primary" onClick={() => go("new")}>
              {t("projects.newResearch")}
            </Button>
            <div className={styles.emptyLinks}>
              {FILTERS.filter((value) => value !== filter).map((value) => {
                const count = rows.filter(
                  ({ research }) => researchTaskFilter(research) === value,
                ).length;
                const Icon = ICONS[value];
                return (
                  count > 0 && (
                    <a
                      key={value}
                      href={`#tasks/${value}`}
                      onClick={followLink(go, `tasks/${value}`)}
                    >
                      <Icon size={20} aria-hidden />
                      <span>{t(`tasks.filter.${value}` as MessageKey)}</span>
                      <strong>{count}</strong>
                    </a>
                  )
                );
              })}
            </div>
          </div>
        ) : (
          <>
            <header className={styles.header}>
              <h1 id="task-center-title">
                {t(`tasks.filter.${filter}` as MessageKey)}
              </h1>
              <p>{t("tasks.description")}</p>
            </header>
            <TextField
              type="search"
              label={t("workspace.searchResearch")}
              hideLabel
              placeholder={t("workspace.searchResearch")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {!ready && !error && (
              <div className={styles.feedback}>
                <Spinner />
                <p>{t("common.loading")}</p>
              </div>
            )}
            {error && (
              <div className={styles.feedback}>
                <p role="alert">{error}</p>
                <Button variant="secondary" onClick={reload}>
                  {t("common.retry")}
                </Button>
              </div>
            )}
            <div className={styles.list}>
              {visible.map(({ research, workspace }) => {
                const machine = workspaceMachine(
                  workspace.location,
                  connections,
                  t("workspace.local"),
                  t("workspace.remote"),
                );
                const path = taskPath(filter, research.id);
                const when = new Date(
                  /(?:Z|[+-]\d\d:\d\d)$/.test(research.updated_at)
                    ? research.updated_at
                    : `${research.updated_at}Z`,
                );
                return (
                  <a
                    key={research.id}
                    className={styles.task}
                    href={`#${path}`}
                    onClick={followLink(go, path)}
                  >
                    <div className={styles.taskHead}>
                      <strong>{research.title || research.question}</strong>
                      <span className={styles.state} data-state={filter}>
                        {t(researchStatus(research))}
                      </span>
                    </div>
                    <div className={styles.location} title={machine.title}>
                      {machine.remote ? (
                        <Server size={13} aria-hidden />
                      ) : (
                        <Monitor size={13} aria-hidden />
                      )}
                      <span>{machine.label}</span>
                      <span aria-hidden>·</span>
                      <span>{workspace.name}</span>
                    </div>
                    {research.progress && <p>{research.progress}</p>}
                    <div className={styles.taskFoot}>
                      {!Number.isNaN(when.getTime()) && (
                        <time
                          dateTime={research.updated_at}
                          title={when.toLocaleString(locale)}
                        >
                          {when.toLocaleDateString(locale, {
                            month: "short",
                            day: "numeric",
                          })}
                        </time>
                      )}
                      <span>
                        {t("tasks.openResearch")}
                        <ArrowUpRight size={13} aria-hidden />
                      </span>
                    </div>
                  </a>
                );
              })}
            </div>
            {ready && !error && !visible.length && (
              <p className={styles.empty}>
                {query
                  ? t("tasks.emptySearch")
                  : t(`tasks.empty.${filter}` as MessageKey)}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
