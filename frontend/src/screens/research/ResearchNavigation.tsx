import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Plus,
  Bell,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { useLocal } from "../../app/edition";
import { AppActions } from "../../app/AppSidebar";
import { followLink } from "../../reader/route";
import { Button, Floating, IconButton, Spinner } from "../../ui";
import {
  readNavigation,
  readConnections,
  RESEARCH_NAVIGATION_EVENT,
  type ResearchNavigation as Navigation,
  type SSHConnection,
} from "./navigation-api";
import {
  focusTreeGroup,
  readTreePreferences,
  writeTreePreferences,
} from "./navigation-preferences";
import { researchStatus } from "./navigation-status";
import { threadTree } from "./thread-tree";
import type { NavigationResearch } from "./navigation-api";
import styles from "./Workspace.module.css";

const EMPTY: Navigation = { workspaces: [], collections: [] };
const Context = createContext({
  data: EMPTY,
  connections: [] as SSHConnection[],
  ready: false,
  loading: false,
  error: "",
  reload: () => {},
});
export const useResearchNavigation = () => useContext(Context);

export function ResearchNavigationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const local = useLocal();
  const [data, setData] = useState<Navigation>(EMPTY);
  const [connections, setConnections] = useState<SSHConnection[]>([]);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reads, setReads] = useState(0);
  const reload = useCallback(() => setReads((n) => n + 1), []);
  useEffect(() => {
    if (local !== true) return;
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([readNavigation(), readConnections()])
      .then(([navigation, devices]) => {
        if (cancelled) return;
        if (devices.status === "fulfilled") setConnections(devices.value);
        if (navigation.status === "fulfilled") {
          setData(navigation.value);
          setReady(true);
          setError("");
        } else {
          const reason: unknown = navigation.reason;
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [local, reads]);
  useEffect(() => {
    if (local !== true) return;
    const refresh = () => {
      if (!document.hidden) reload();
    };
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener(RESEARCH_NAVIGATION_EVENT, reload);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener(RESEARCH_NAVIGATION_EVENT, reload);
      window.removeEventListener("focus", refresh);
    };
  }, [local, reload]);
  return (
    <Context.Provider
      value={{ data, connections, ready, loading, error, reload }}
    >
      {children}
    </Context.Provider>
  );
}

export function ResearchState({ research }: { research: NavigationResearch }) {
  const { t } = useI18n();
  const status = researchStatus(research);
  if (research.working)
    return (
      <span
        className={styles.treeIndicator}
        role="img"
        aria-label={t("research.status.running")}
      >
        <Spinner size={14} />
      </span>
    );
  if (research.unread || status === "research.status.waiting")
    return (
      <span
        className={styles.treeDot}
        role="img"
        aria-label={t(
          status === "research.status.waiting" ? status : "research.unread",
        )}
      />
    );
  return null;
}

export function ResearchNotifications({ go }: { go(hash: string): void }) {
  const { t } = useI18n();
  const { data } = useResearchNavigation();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const rows = data.workspaces
    .filter((w) => !w.archived)
    .flatMap((w) => w.researches)
    .filter(
      (r) =>
        !r.archived_at &&
        (researchStatus(r) === "research.status.waiting" ||
          (r.unread && r.status === "paused")),
    );
  return (
    <>
      <span className={styles.notificationAnchor}>
        <IconButton
          ref={anchor}
          icon={Bell}
          label={t("research.notifications")}
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        />
        {!!rows.length && <i className={styles.bellDot} />}
      </span>
      <Floating
        open={open}
        anchor={anchor.current}
        ignore={anchor.current}
        placement={{ side: "bottom", align: "end" }}
        onDismiss={() => setOpen(false)}
        className={styles.notifications}
      >
        <div role="dialog" aria-label={t("research.notifications")}>
          <h3>{t("research.notifications")}</h3>
          {rows.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                go(`research/${r.id}`);
                setOpen(false);
              }}
            >
              <ResearchState research={r} />
              <span>{r.title || r.question}</span>
              <small>{t(researchStatus(r))}</small>
            </button>
          ))}
          {!rows.length && (
            <div className={styles.notificationEmpty}>
              <Bell size={24} aria-hidden />
              <span>{t("research.notifications.empty")}</span>
            </div>
          )}
        </div>
      </Floating>
    </>
  );
}

export function ResearchTree({
  currentId,
  go,
  onChoose,
}: {
  currentId?: string;
  go(hash: string): void;
  onChoose?(): void;
}) {
  const { t } = useI18n();
  const { owner = "" } = useContext(AppActions);
  const { data, ready, loading, error, reload } = useResearchNavigation();
  const [preferences, setPreferences] = useState(() =>
    readTreePreferences(owner),
  );
  const [expanded, setExpanded] = useState<string[]>([]);
  const previousSelection = useRef("");
  const all = data.workspaces
    .filter((w) => !w.archived)
    .flatMap((w) => w.researches)
    .filter((r) => !r.archived_at);
  const current = all.find((r) => r.id === currentId);
  const targetWorkspace =
    current?.workspace_id ||
    new URLSearchParams(window.location.hash.split("?")[1] || "").get(
      "workspace",
    ) ||
    undefined;
  const selection = currentId || window.location.hash;
  useEffect(() => {
    if (!ready) return;
    const changed =
      !!previousSelection.current && previousSelection.current !== selection;
    previousSelection.current = selection;
    setPreferences((old) =>
      focusTreeGroup(
        old,
        "workspace",
        targetWorkspace,
        data.workspaces[0]?.id || "",
        changed,
      ),
    );
  }, [ready, selection, targetWorkspace, data.workspaces]);
  useEffect(() => {
    if (ready) writeTreePreferences(owner, preferences);
  }, [owner, preferences, ready]);
  const choose = (hash: string) => {
    go(hash);
    onChoose?.();
  };
  const link = (research: NavigationResearch, depth = 0) => (
    <a
      key={research.id}
      className={styles.treeResearch}
      style={{ paddingLeft: 14 + depth * 16 }}
      title={research.question}
      aria-label={research.title || research.question}
      aria-description={t(researchStatus(research))}
      href={`#research/${research.id}`}
      aria-current={currentId === research.id ? "page" : undefined}
      onClick={followLink(choose, `research/${research.id}`)}
    >
      <span className={styles.treeResearchTitle}>
        {research.title || research.question}
      </span>
      <ResearchState research={research} />
    </a>
  );
  return (
    <div className={styles.tree}>
      <div className={styles.treeHeading}>
        <span>{t("workspace.workspaces")}</span>
        <IconButton
          size="sm"
          icon={FolderPlus}
          label={t("workspace.manage")}
          onClick={() => choose("workspaces")}
        />
      </div>
      {loading && !ready && <Spinner size={14} />}
      {error && (
        <Button size="sm" variant="ghost" title={error} onClick={reload}>
          {t("common.retry")}
        </Button>
      )}
      {data.workspaces
        .filter((w) => !w.archived)
        .map((w) => {
          const opened = preferences.workspace?.open.includes(w.id) ?? false;
          const rows = threadTree(w.researches.filter((r) => !r.archived_at));
          const visible = expanded.includes(w.id) ? rows : rows.slice(0, 5);
          return (
            <div key={w.id} className={styles.treeGroup}>
              <div className={styles.treeFolder}>
                <button
                  className={styles.treeChevron}
                  aria-label={t("research.toggleProject", { name: w.name })}
                  aria-expanded={opened}
                  onClick={() =>
                    setPreferences((old) => {
                      const previous = old.workspace || {
                        open: [],
                        expanded: [],
                      };
                      return {
                        ...old,
                        workspace: {
                          ...previous,
                          open: opened
                            ? previous.open.filter((id) => id !== w.id)
                            : [...previous.open, w.id],
                        },
                      };
                    })
                  }
                >
                  {opened ? (
                    <ChevronDown size={13} aria-hidden />
                  ) : (
                    <ChevronRight size={13} aria-hidden />
                  )}
                </button>
                <a
                  className={styles.treeFolderLink}
                  href={`#workspaces/${w.id}`}
                  onClick={followLink(choose, `workspaces/${w.id}`)}
                >
                  <Folder size={15} aria-hidden />
                  <span>{w.name}</span>
                </a>
                <a
                  className={styles.treeAdd}
                  href={`#new?workspace=${w.id}`}
                  aria-label={t("workspace.newIn", { name: w.name })}
                  onClick={followLink(choose, `new?workspace=${w.id}`)}
                >
                  <Plus size={14} aria-hidden />
                </a>
              </div>
              {opened && (
                <div className={styles.treeThreads}>
                  {visible.map(({ research, depth }) => link(research, depth))}
                  {rows.length > 5 && (
                    <button
                      className={styles.treeMore}
                      onClick={() =>
                        setExpanded((old) =>
                          old.includes(w.id)
                            ? old.filter((id) => id !== w.id)
                            : [...old, w.id],
                        )
                      }
                    >
                      {t(
                        expanded.includes(w.id)
                          ? "projects.notes.less"
                          : "workspace.showMore",
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      {!all.length && !data.workspaces.length && !loading && (
        <button
          className={styles.treeEmpty}
          onClick={() => choose("workspaces")}
        >
          {t("workspace.add")}
        </button>
      )}
      {!!all.length && (
        <>
          <div className={styles.treeHeading}>{t("research.recent")}</div>
          {[...all]
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
            .slice(0, 20)
            .map((r) => link(r))}
        </>
      )}
    </div>
  );
}

export { researchStatus } from "./navigation-status";
