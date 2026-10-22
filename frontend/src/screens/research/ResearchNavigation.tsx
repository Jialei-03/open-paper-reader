import {
  ChevronDown,
  ChevronRight,
  Check,
  Folder,
  FolderPlus,
  Pin,
  Plus,
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
import { Button, IconButton, Menu, Spinner } from "../../ui";
import {
  readNavigation,
  readConnections,
  RESEARCH_NAVIGATION_EVENT,
  type ResearchNavigation as Navigation,
  type SSHConnection,
} from "./navigation-api";
import { workspaceMachine } from "./workspace-machine";
import {
  focusTreeGroup,
  readTreePreferences,
  rememberedTreeWorkspace,
  visibleTreeRows,
  writeTreePreferences,
  type ResearchTreePreferences,
} from "./navigation-preferences";
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
  const { data, connections, ready, loading, error, reload } =
    useResearchNavigation();
  const [saved, setSaved] = useState(() => ({
    owner,
    preferences: readTreePreferences(owner),
  }));
  const { mode } = saved.preferences;
  const preferences = saved.preferences[mode];
  const previousSelection = useRef("");
  const hash = window.location.hash.slice(1);
  const updatePreferences = (
    update: (old: ResearchTreePreferences) => ResearchTreePreferences,
  ) =>
    setSaved((old) =>
      old.owner === owner
        ? { ...old, preferences: update(old.preferences) }
        : old,
    );
  useEffect(() => {
    setSaved((old) =>
      old.owner === owner
        ? old
        : { owner, preferences: readTreePreferences(owner) },
    );
    previousSelection.current = "";
  }, [owner]);
  useEffect(() => {
    if (saved.owner === owner && ready)
      writeTreePreferences(owner, saved.preferences);
  }, [owner, saved, ready]);
  const all = data.workspaces
    .filter((workspace) => !workspace.archived)
    .flatMap((workspace) => workspace.researches);
  const groups =
    mode === "workspace"
      ? data.workspaces
          .filter((workspace) => !workspace.archived)
          .map((workspace) => ({
            id: workspace.id,
            name: workspace.name,
            machine: workspaceMachine(
              workspace.location,
              connections,
              t("workspace.local"),
              t("workspace.remote"),
            ),
            hash: `workspaces/${workspace.id}`,
            start: `new?workspace=${workspace.id}`,
            rows: workspace.researches,
          }))
      : [
          ...data.collections
            .filter((collection) => !collection.archived)
            .map((collection) => ({
              id: collection.id,
              name: collection.name,
              machine: undefined,
              hash: `collections/${collection.id}`,
              start: `new?collection=${collection.id}`,
              rows: all.filter(
                (research) => research.collection_id === collection.id,
              ),
            })),
          {
            id: "unclassified",
            name: t("workspace.unclassified"),
            machine: undefined,
            hash: "collections/unclassified",
            start: "new",
            rows: all.filter((research) => !research.collection_id),
          },
        ];
  const selectedResearch = currentId
    ? all.find((research) => research.id === currentId)
    : undefined;
  const [route, query = ""] = hash.split("?");
  const params = new URLSearchParams(query);
  const selectedGroup = selectedResearch
    ? mode === "workspace"
      ? selectedResearch.workspace_id
      : selectedResearch.collection_id || "unclassified"
    : route === "new"
      ? params.get(mode === "workspace" ? "workspace" : "collection") ||
        (mode === "workspace" ? rememberedTreeWorkspace(owner) : undefined)
      : route.startsWith(mode === "workspace" ? "workspaces/" : "collections/")
        ? route.split("/")[1]
        : undefined;
  const focusedId = groups.find((group) => group.id === selectedGroup)?.id;
  const groupIds = groups.map((group) => group.id).join(",");
  // The selection key changes on navigation, not on the five-second refresh.
  // A user's manual fold is therefore respected while they remain in a research.
  const selection = `${owner}:${mode}:${currentId || hash}:${focusedId || ""}`;
  useEffect(() => {
    if (saved.owner !== owner || !ready || !groupIds) return;
    const changed =
      !!previousSelection.current && previousSelection.current !== selection;
    previousSelection.current = selection;
    setSaved((old) => {
      if (old.owner !== owner) return old;
      const next = focusTreeGroup(
        old.preferences,
        mode,
        focusedId,
        groupIds.split(",")[0],
        changed,
      );
      return next === old.preferences ? old : { ...old, preferences: next };
    });
  }, [owner, saved.owner, ready, mode, groupIds, focusedId, selection]);
  const choose = (hash: string) => {
    go(hash);
    onChoose?.();
  };
  return (
    <div className={styles.tree}>
      <div className={styles.treeHeading}>
        <Menu
          label={t("workspace.groupBy")}
          trigger={(props) => (
            <button
              {...props}
              type="button"
              className={styles.treeGrouping}
              aria-label={t("workspace.groupBy")}
            >
              {t(
                mode === "workspace"
                  ? "workspace.workspaces"
                  : "workspace.collections",
              )}
              <ChevronDown size={12} aria-hidden />
            </button>
          )}
          items={[
            {
              id: "workspace",
              label: t("workspace.workspaces"),
              icon: mode === "workspace" ? Check : Folder,
              onSelect: () =>
                updatePreferences((old) => ({ ...old, mode: "workspace" })),
            },
            {
              id: "collection",
              label: t("workspace.collections"),
              icon: mode === "collection" ? Check : Folder,
              onSelect: () =>
                updatePreferences((old) => ({ ...old, mode: "collection" })),
            },
          ]}
        />
        <IconButton
          size="sm"
          icon={FolderPlus}
          label={t(
            mode === "workspace"
              ? "workspace.manage"
              : "workspace.manageCollections",
          )}
          onClick={() =>
            choose(mode === "workspace" ? "workspaces" : "collections")
          }
        />
      </div>
      {loading && !groups.length && <Spinner size={14} />}
      {error && (
        <Button size="sm" variant="ghost" title={error} onClick={reload}>
          {t("common.retry")}
        </Button>
      )}
      {groups.map((group) => {
        const rows = [...group.rows].sort(
          (a, b) =>
            Number(!!b.pinned_at) - Number(!!a.pinned_at) ||
            b.updated_at.localeCompare(a.updated_at),
        );
        const opened =
          preferences?.open.includes(group.id) ?? group.id === focusedId;
        const expanded = preferences?.expanded.includes(group.id) ?? false;
        const visible = visibleTreeRows(rows, currentId, expanded);
        return (
          <div key={group.id} className={styles.treeGroup}>
            <div className={styles.treeFolder}>
              <button
                aria-expanded={opened}
                aria-current={
                  !currentId && group.id === focusedId ? "location" : undefined
                }
                onClick={() =>
                  updatePreferences((old) => {
                    const previous = old[mode] || { open: [], expanded: [] };
                    return {
                      ...old,
                      [mode]: {
                        ...previous,
                        open: previous.open.includes(group.id)
                          ? previous.open.filter((id) => id !== group.id)
                          : [...previous.open, group.id],
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
                <Folder size={15} aria-hidden />
                <span className={styles.treeFolderText}>
                  <span className={styles.treeFolderName}>{group.name}</span>
                  {group.machine && (
                    <small
                      className={styles.treeMachine}
                      title={group.machine.title}
                    >
                      {group.machine.label}
                    </small>
                  )}
                </span>
              </button>
              <a
                href={`#${group.start}`}
                aria-label={t("workspace.newIn", { name: group.name })}
                onClick={followLink(choose, group.start)}
              >
                <Plus size={14} aria-hidden />
              </a>
            </div>
            {opened && (
              <div className={styles.treeThreads}>
                {visible.map((research) => (
                  <a
                    key={research.id}
                    className={styles.treeResearch}
                    title={research.title || research.question}
                    href={`#research/${research.id}`}
                    aria-current={
                      currentId === research.id ? "page" : undefined
                    }
                    onClick={followLink(choose, `research/${research.id}`)}
                  >
                    <span className={styles.treeResearchTitle}>
                      {research.title || research.question}
                    </span>
                    {research.pinned_at && <Pin size={12} aria-hidden />}
                    {!!research.working && (
                      <span className={styles.treeActivity} aria-hidden />
                    )}
                  </a>
                ))}
                {!rows.length && (
                  <button
                    className={styles.treeEmpty}
                    onClick={() => choose(group.start)}
                  >
                    {t("workspace.startFirst")}
                  </button>
                )}
                {rows.length > 5 && (
                  <button
                    className={styles.treeMore}
                    onClick={() =>
                      updatePreferences((old) => {
                        const previous = old[mode] || {
                          open: [],
                          expanded: [],
                        };
                        return {
                          ...old,
                          [mode]: {
                            ...previous,
                            expanded: expanded
                              ? previous.expanded.filter(
                                  (id) => id !== group.id,
                                )
                              : [...previous.expanded, group.id],
                          },
                        };
                      })
                    }
                  >
                    {t(expanded ? "projects.notes.less" : "workspace.showMore")}
                  </button>
                )}
                <a
                  className={styles.treeOpen}
                  href={`#${group.hash}`}
                  onClick={followLink(choose, group.hash)}
                >
                  {t("workspace.openFolder")}
                </a>
              </div>
            )}
          </div>
        );
      })}
      {!groups.length && !loading && !error && (
        <button
          className={styles.treeEmpty}
          onClick={() => choose("workspaces")}
        >
          {t("workspace.add")}
        </button>
      )}
    </div>
  );
}

export { researchStatus } from "./navigation-status";
