import {
  ArrowLeft,
  Folder,
  LayoutGrid,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  SquarePen,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { followLink } from "../../reader/route";
import {
  Button,
  Dialog,
  IconButton,
  Menu,
  SegmentedControl,
  Spinner,
  TextArea,
  TextField,
  toast,
} from "../../ui";
import {
  createCollection,
  organizeResearch,
  readResearchBoard,
  refreshResearchNavigation,
  updateCollection,
  type NavigationResearch,
  type ResearchCollection,
} from "./navigation-api";
import { researchStatus, useResearchNavigation } from "./ResearchNavigation";
import type { Column, ResearchProject } from "./research-api";
import { ProjectResults } from "./projects/ProjectResults";
import { ConnectionsDialog, CreateWorkspaceDialog } from "./WorkspaceDialogs";
import { workspaceMachine } from "./workspace-machine";
import styles from "./Workspace.module.css";

function fail(reason: unknown) {
  toast.show({
    message: reason instanceof Error ? reason.message : String(reason),
    tone: "error",
  });
}

export function ResearchOrganization({
  project,
  onChanged,
}: {
  project: ResearchProject;
  onChanged(): void;
}) {
  const { t } = useI18n();
  const { data } = useResearchNavigation();
  const [naming, setNaming] = useState(false);
  const [title, setTitle] = useState("");
  const [classifying, setClassifying] = useState(false);
  const [busy, setBusy] = useState(false);
  const workspace = data.workspaces.find(
    (item) => item.id === project.workspace_id,
  );
  const change = async (body: Parameters<typeof organizeResearch>[1]) => {
    setBusy(true);
    try {
      await organizeResearch(project.id, body);
      refreshResearchNavigation();
      onChanged();
      return true;
    } catch (reason) {
      fail(reason);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Menu
        label={t("workspace.researchActions")}
        items={[
          {
            id: "name",
            label: t("projects.sessions.rename"),
            icon: SquarePen,
            disabled: busy || workspace?.archived,
            onSelect: () => {
              setTitle(project.title || project.question);
              setNaming(true);
            },
          },
          {
            id: "pin",
            label: t(
              project.pinned_at
                ? "projects.sessions.unpin"
                : "projects.sessions.pin",
            ),
            icon: project.pinned_at ? PinOff : Pin,
            disabled: busy || workspace?.archived,
            onSelect: () => void change({ pinned: !project.pinned_at }),
          },
          {
            id: "board",
            label: t(
              project.on_board ? "workspace.removeBoard" : "workspace.addBoard",
            ),
            icon: LayoutGrid,
            disabled: busy || workspace?.archived,
            onSelect: () => void change({ on_board: !project.on_board }),
          },
          {
            id: "collection",
            label: t("workspace.classify"),
            icon: Folder,
            disabled: busy || workspace?.archived,
            onSelect: () => setClassifying(true),
          },
        ]}
        trigger={(props) => (
          <IconButton
            icon={MoreHorizontal}
            size="sm"
            label={t("workspace.researchActions")}
            {...props}
          />
        )}
      />
      <Dialog
        open={naming}
        title={t("projects.sessions.rename")}
        dismissible={!busy}
        onClose={() => setNaming(false)}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setNaming(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!title.trim()}
              onClick={async () => {
                if (await change({ title: title.trim() })) setNaming(false);
              }}
            >
              {t("projects.save")}
            </Button>
          </>
        }
      >
        <TextField
          label={t("workspace.researchTitle")}
          value={title}
          disabled={busy}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Dialog>
      <Dialog
        open={classifying}
        title={t("workspace.classify")}
        onClose={() => setClassifying(false)}
        dismissible={!busy}
      >
        <div className={styles.classifyList}>
          {[
            { id: "", name: t("workspace.unclassified") },
            ...data.collections.filter((item) => !item.archived),
          ].map((item) => (
            <Button
              key={item.id}
              variant={
                project.collection_id === item.id ||
                (!project.collection_id && !item.id)
                  ? "secondary"
                  : "ghost"
              }
              disabled={busy}
              onClick={async () => {
                if (await change({ collection_id: item.id || null }))
                  setClassifying(false);
              }}
            >
              {item.name}
            </Button>
          ))}
        </div>
      </Dialog>
    </>
  );
}

export function WorkspaceScreen({
  id,
  tab,
  go,
}: {
  id?: string;
  tab?: string;
  go(hash: string): void;
}) {
  const { t } = useI18n();
  const { data, connections, loading, error, reload } = useResearchNavigation();
  const [creating, setCreating] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const workspace = data.workspaces.find((item) => item.id === id);
  const machine = (location: Parameters<typeof workspaceMachine>[0]) =>
    workspaceMachine(
      location,
      connections,
      t("workspace.local"),
      t("workspace.remote"),
    );
  return (
    <main className={styles.page}>
      <header className={styles.pageHead}>
        {id && (
          <IconButton
            icon={ArrowLeft}
            label={t("workspace.workspaces")}
            onClick={() => go("workspaces")}
          />
        )}
        <div>
          <h1>{workspace?.name || t("workspace.workspaces")}</h1>
          {workspace && (
            <p title={machine(workspace.location).title}>
              {machine(workspace.location).label} · {workspace.location.path}
            </p>
          )}
        </div>
        {workspace ? (
          <>
            <SegmentedControl
              kind="radio"
              size="sm"
              label={t("projects.view")}
              value={tab === "results" ? "results" : "research"}
              onChange={(next) =>
                go(`workspaces/${id}${next === "results" ? "/results" : ""}`)
              }
              options={[
                { value: "research", label: t("workspace.researches") },
                { value: "results", label: t("projects.view.results") },
              ]}
            />
            <Button
              size="sm"
              icon={Plus}
              onClick={() => go(`new?workspace=${id}`)}
            >
              {t("projects.newResearch")}
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              icon={Settings}
              onClick={() => setConnectionsOpen(true)}
            >
              {t("workspace.connections")}
            </Button>
            <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
              {t("workspace.add")}
            </Button>
          </>
        )}
      </header>
      {error && (
        <div className={styles.feedback}>
          <p role="alert">{error}</p>
          <Button onClick={reload}>{t("common.retry")}</Button>
        </div>
      )}
      {loading && !data.workspaces.length ? (
        <div className={styles.feedback}>
          <Spinner />
        </div>
      ) : workspace ? (
        tab === "results" ? (
          <ProjectResults workspaceId={workspace.id} refreshKey={0} go={go} />
        ) : (
          <ResearchRows rows={workspace.researches} go={go} />
        )
      ) : id ? (
        <p className={styles.empty}>{t("workspace.notFound")}</p>
      ) : (
        <div className={styles.folderCards}>
          {data.workspaces
            .filter((item) => !item.archived)
            .map((item) => (
              <a
                key={item.id}
                href={`#workspaces/${item.id}`}
                onClick={followLink(go, `workspaces/${item.id}`)}
              >
                <Folder size={22} aria-hidden />
                <span>
                  <strong>{item.name}</strong>
                  <small title={machine(item.location).title}>
                    {machine(item.location).label} · {item.location.path}
                  </small>
                </span>
                <span>{item.researches.length}</span>
              </a>
            ))}
          {!data.workspaces.length && (
            <p className={styles.empty}>{t("workspace.noWorkspaces")}</p>
          )}
        </div>
      )}
      {creating && (
        <CreateWorkspaceDialog
          onClose={() => setCreating(false)}
          onCreated={(item) => {
            setCreating(false);
            go(`workspaces/${item.id}`);
          }}
        />
      )}
      {connectionsOpen && (
        <ConnectionsDialog onClose={() => setConnectionsOpen(false)} />
      )}
    </main>
  );
}

export function CollectionScreen({
  id,
  go,
}: {
  id?: string;
  go(hash: string): void;
}) {
  const { t } = useI18n();
  const { data, loading, error, reload } = useResearchNavigation();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const collection = data.collections.find((item) => item.id === id);
  const rows = data.workspaces
    .filter((item) => !item.archived)
    .flatMap((item) => item.researches);
  const filtered = rows.filter((item) =>
    id === "unclassified" ? !item.collection_id : item.collection_id === id,
  );
  return (
    <main className={styles.page}>
      <header className={styles.pageHead}>
        {id && (
          <IconButton
            icon={ArrowLeft}
            label={t("workspace.collections")}
            onClick={() => go("collections")}
          />
        )}
        <div>
          <h1>
            {id === "unclassified"
              ? t("workspace.unclassified")
              : collection?.name || t("workspace.collections")}
          </h1>
          {collection?.description && <p>{collection.description}</p>}
        </div>
        {collection && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            {t("projects.edit")}
          </Button>
        )}
        <Button
          size="sm"
          icon={Plus}
          onClick={() =>
            id
              ? go(`new${id !== "unclassified" ? `?collection=${id}` : ""}`)
              : setCreating(true)
          }
        >
          {t(id ? "projects.newResearch" : "workspace.addCollection")}
        </Button>
      </header>
      {error && (
        <div className={styles.feedback}>
          <p role="alert">{error}</p>
          <Button onClick={reload}>{t("common.retry")}</Button>
        </div>
      )}
      {loading && !data.collections.length ? (
        <div className={styles.feedback}>
          <Spinner />
        </div>
      ) : id ? (
        <ResearchRows rows={filtered} go={go} />
      ) : (
        <div className={styles.folderCards}>
          {data.collections
            .filter((item) => !item.archived)
            .map((item) => (
              <a
                key={item.id}
                href={`#collections/${item.id}`}
                onClick={followLink(go, `collections/${item.id}`)}
              >
                <Folder size={22} aria-hidden />
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {item.description || t("workspace.classificationOnly")}
                  </small>
                </span>
                <span>
                  {
                    rows.filter(
                      (research) => research.collection_id === item.id,
                    ).length
                  }
                </span>
              </a>
            ))}
          <a
            href="#collections/unclassified"
            onClick={followLink(go, "collections/unclassified")}
          >
            <Folder size={22} aria-hidden />
            <strong>{t("workspace.unclassified")}</strong>
          </a>
        </div>
      )}
      {creating && (
        <CollectionDialog
          onClose={() => setCreating(false)}
          onCreated={(item) => {
            setCreating(false);
            go(`collections/${item.id}`);
          }}
        />
      )}
      {editing && collection && (
        <CollectionDialog
          collection={collection}
          onClose={() => setEditing(false)}
          onCreated={() => setEditing(false)}
        />
      )}
    </main>
  );
}

export function CollectionDialog({
  collection,
  onClose,
  onCreated,
}: {
  collection?: ResearchCollection;
  onClose(): void;
  onCreated(item: ResearchCollection): void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(collection?.name || "");
  const [description, setDescription] = useState(collection?.description || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      open
      title={t(
        collection ? "workspace.editCollection" : "workspace.addCollection",
      )}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!name.trim()}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const item = collection
                  ? await updateCollection(collection.id, {
                      name: name.trim(),
                      description,
                    })
                  : await createCollection(name.trim(), description);
                refreshResearchNavigation();
                onCreated(item);
              } catch (reason) {
                setError(
                  reason instanceof Error ? reason.message : String(reason),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("projects.save")}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        <TextField
          label={t("projects.name")}
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
        <TextArea
          label={t("projects.about")}
          value={description}
          disabled={busy}
          onChange={(event) => setDescription(event.target.value)}
        />
        <p className={styles.muted}>{t("workspace.classificationOnly")}</p>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

export function ResearchRows({
  rows,
  go,
}: {
  rows: NavigationResearch[];
  go(hash: string): void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const filtered = rows
    .filter((item) =>
      `${item.title} ${item.question}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(!!b.pinned_at) - Number(!!a.pinned_at) ||
        b.updated_at.localeCompare(a.updated_at),
    );
  return (
    <div className={styles.researchList}>
      <TextField
        type="search"
        label={t("workspace.searchResearch")}
        hideLabel
        placeholder={t("workspace.searchResearch")}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {filtered.map((item) => (
        <a
          key={item.id}
          href={`#research/${item.id}`}
          onClick={followLink(go, `research/${item.id}`)}
        >
          <span className={styles.rowTitle}>
            {item.pinned_at && <Pin size={12} aria-hidden />}
            {item.title || item.question}
          </span>
          <span className={styles.rowStatus}>{t(researchStatus(item))}</span>
          {item.title && item.title !== item.question && <p>{item.question}</p>}
          {item.progress && <p>{item.progress}</p>}
          {(item.merged?.memory || item.merged?.code) && (
            <small>{t("research.merge.applied")}</small>
          )}
          {item.forked_from?.research_id && (
            <small>
              ↳ {item.forked_from.question} ·{" "}
              {t("research.sprint", { number: item.forked_from.number })}
            </small>
          )}
        </a>
      ))}
      {!filtered.length && (
        <p className={styles.empty}>{t("projects.noResearch")}</p>
      )}
    </div>
  );
}

export function ResearchBoard({ go }: { go(hash: string): void }) {
  const { t } = useI18n();
  const { data: navigation, connections } = useResearchNavigation();
  const [board, setBoard] = useState<{
    columns: Column[];
    cards: NavigationResearch[];
  } | null>(null);
  const [error, setError] = useState("");
  const [reads, setReads] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const context = (item: NavigationResearch) => {
    const workspace = navigation.workspaces.find(
      (row) => row.id === item.workspace_id,
    );
    if (!workspace) return "";
    return `${workspace.name} · ${workspaceMachine(workspace.location, connections, t("workspace.local"), t("workspace.remote")).label}`;
  };
  useEffect(() => {
    let cancelled = false;
    readResearchBoard().then(
      (value) => {
        if (!cancelled) {
          setBoard(value);
          setError("");
        }
      },
      (reason: unknown) =>
        !cancelled &&
        setError(reason instanceof Error ? reason.message : String(reason)),
    );
    return () => {
      cancelled = true;
    };
  }, [navigation, reads]);
  return (
    <main className={styles.page}>
      <header className={styles.pageHead}>
        <div>
          <h1>{t("projects.view.board")}</h1>
          <p>{t("workspace.boardHint")}</p>
        </div>
        {board && board.cards.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowEmpty(!showEmpty)}
          >
            {t(
              showEmpty
                ? "workspace.hideEmptyColumns"
                : "workspace.showEmptyColumns",
            )}
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={Plus} onClick={() => go("new")}>
          {t("projects.newResearch")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={LayoutGrid}
          disabled={!board}
          onClick={() => setSelecting(true)}
        >
          {t("workspace.selectBoard")}
        </Button>
      </header>
      {error && (
        <div className={styles.feedback}>
          <p role="alert">{error}</p>
          <Button onClick={() => setReads((n) => n + 1)}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {!board && !error && (
        <div className={styles.feedback}>
          <Spinner />
        </div>
      )}
      {board && !board.cards.length ? (
        <div className={styles.emptyBoard}>
          <LayoutGrid size={28} aria-hidden />
          <h2>{t("workspace.emptyBoard")}</h2>
          <p>{t("workspace.boardHint")}</p>
          <Button onClick={() => setSelecting(true)}>
            {t("workspace.selectBoard")}
          </Button>
        </div>
      ) : (
        board && (
          <div className={styles.board}>
            {board.columns
              .filter(
                (column) =>
                  showEmpty ||
                  board.cards.some((item) => item.column === column),
              )
              .map((column) => (
                <section
                  key={column}
                  aria-label={t(`projects.column.${column}`)}
                >
                  <h2>
                    {t(`projects.column.${column}`)}{" "}
                    <span>
                      {
                        board.cards.filter((item) => item.column === column)
                          .length
                      }
                    </span>
                  </h2>
                  {board.cards
                    .filter((item) => item.column === column)
                    .map((item) => (
                      <article key={item.id}>
                        <a
                          href={`#research/${item.id}`}
                          onClick={followLink(go, `research/${item.id}`)}
                        >
                          <strong>{item.title || item.question}</strong>
                          <span className={styles.boardWorkspace}>
                            {context(item)}
                          </span>
                          <p title={item.progress}>{item.progress}</p>
                          <small>{t(researchStatus(item))}</small>
                        </a>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            try {
                              await organizeResearch(item.id, {
                                on_board: false,
                              });
                              refreshResearchNavigation();
                              setReads((n) => n + 1);
                            } catch (reason) {
                              fail(reason);
                            }
                          }}
                        >
                          {t("workspace.removeBoard")}
                        </Button>
                      </article>
                    ))}
                </section>
              ))}
          </div>
        )
      )}
      {selecting && (
        <BoardSelection
          selected={board?.cards || []}
          onClose={() => setSelecting(false)}
          onChanged={() => setReads((n) => n + 1)}
          go={go}
        />
      )}
    </main>
  );
}

function BoardSelection({
  selected,
  onClose,
  onChanged,
  go,
}: {
  selected: NavigationResearch[];
  onClose(): void;
  onChanged(): void;
  go(hash: string): void;
}) {
  const { t } = useI18n();
  const {
    data,
    connections,
    loading,
    error: navigationError,
    reload,
  } = useResearchNavigation();
  const [checked, setChecked] = useState(
    () => new Set(selected.map((item) => item.id)),
  );
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const groups = data.workspaces
    .filter((workspace) => !workspace.archived)
    .map((workspace) => ({
      ...workspace,
      machine: workspaceMachine(
        workspace.location,
        connections,
        t("workspace.local"),
        t("workspace.remote"),
      ),
      researches: workspace.researches.filter((item) =>
        `${item.title} ${item.question} ${workspace.name}`
          .toLocaleLowerCase()
          .includes(query),
      ),
    }))
    .filter((workspace) => workspace.researches.length > 0);
  const toggle = async (id: string, value: boolean) => {
    if (busy) return;
    setBusy(id);
    setError("");
    try {
      await organizeResearch(id, { on_board: value });
      setChecked((old) => {
        const next = new Set(old);
        if (value) next.add(id);
        else next.delete(id);
        return next;
      });
      refreshResearchNavigation();
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy("");
    }
  };
  return (
    <Dialog
      open
      title={t("workspace.selectBoard")}
      description={t("workspace.selectBoardHint")}
      onClose={onClose}
      dismissible={!busy}
      size="md"
      footer={
        <>
          <span className={styles.selectionCount} role="status">
            {t("workspace.selectedCount", { n: checked.size })}
          </span>
          <Button variant="primary" disabled={!!busy} onClick={onClose}>
            {t("common.confirm")}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        <TextField
          type="search"
          label={t("workspace.searchResearch")}
          hideLabel
          placeholder={t("workspace.searchResearch")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {(error || navigationError) && (
          <div role="alert" className={styles.error}>
            {error || navigationError}
            {navigationError && (
              <Button size="sm" variant="ghost" onClick={reload}>
                {t("common.retry")}
              </Button>
            )}
          </div>
        )}
        {loading && !data.workspaces.length && <Spinner size={16} />}
        <div className={styles.boardChoices}>
          {groups.map((workspace) => (
            <fieldset key={workspace.id}>
              <legend>
                {workspace.name}
                <small title={workspace.machine.title}>
                  {workspace.machine.label}
                </small>
              </legend>
              {workspace.researches.map((item) => (
                <label key={item.id} className={styles.boardChoice}>
                  <input
                    type="checkbox"
                    checked={checked.has(item.id)}
                    disabled={!!busy}
                    onChange={(event) =>
                      void toggle(item.id, event.target.checked)
                    }
                  />
                  <span>
                    <strong>{item.title || item.question}</strong>
                    <small>{t(researchStatus(item))}</small>
                  </span>
                  {busy === item.id && <Spinner size={14} />}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        {!loading && !groups.length && (
          <p className={styles.muted}>
            {query
              ? t("projects.noResearch")
              : t("workspace.noResearchToSelect")}
          </p>
        )}
        {!loading &&
          !data.workspaces.some((workspace) => workspace.researches.length) && (
            <Button
              onClick={() => {
                onClose();
                go("new");
              }}
            >
              {t("projects.newResearch")}
            </Button>
          )}
      </div>
    </Dialog>
  );
}
