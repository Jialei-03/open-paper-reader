import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Lightbulb,
  Microscope,
  Plus,
  Sparkles,
  Target,
  Archive,
  ArchiveRestore,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Search,
  Pencil,
  Settings,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import type { MessageKey } from "../../../i18n/i18n";
import { followLink } from "../../../reader/route";
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
} from "../../../ui";
import { readModels, type ModelRow } from "../../setup/model-api";
import {
  addCard,
  getBoard,
  getWorkspace,
  createProjectChat,
  getChatSession,
  listProjectSessions,
  updateChatSession,
  moveCard,
  readResearchSettings,
  startCard,
  startProject,
  updateWorkspace,
  workspaceNotes,
  type BoardCard,
  type Column,
  type Compute,
  type ProjectSession,
  type ResearchSummary,
  type ResearchNote,
  type Workspace,
} from "../research-api";
import { Mascot } from "../scene/Mascot";
import { Composer } from "../talk/Composer";
import { ComputePicker, ModelPicker } from "../talk/Pickers";
import { ProjectChat } from "./ProjectChats";
import { useResearchNavigation } from "../ResearchNavigation";
import { workspaceMachine } from "../workspace-machine";
import { ProjectResults } from "./ProjectResults";
import styles from "./Projects.module.css";

type View = "main" | "board" | "history" | "results" | "about" | "new-research";
const POLL = 4000;
const KIND_ICON = {
  research: Microscope,
  hypothesis: Target,
  experiment: FlaskConical,
  finding: Sparkles,
  idea: Lightbulb,
} as const;

export function ProjectPage({
  id,
  tab,
  item,
  go,
}: {
  id: string;
  tab?: string;
  item?: string;
  go(hash: string): void;
}) {
  const { t } = useI18n();
  const [w, setW] = useState<
    (Workspace & { researches: ResearchSummary[] }) | null
  >(null);
  const [cards, setCards] = useState<BoardCard[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [notes, setNotes] = useState<ResearchNote[]>([]);
  const [reads, setReads] = useState(0);
  const [failed, setFailed] = useState("");
  const [sessions, setSessions] = useState<ProjectSession[]>([]);
  const [selected, setSelected] = useState<ProjectSession | null>(null);
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [pages, setPages] = useState(1);
  const [more, setMore] = useState(false);
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState("");
  const [opening, setOpening] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [naming, setNaming] = useState<ProjectSession | null>(null);
  const [title, setTitle] = useState("");
  const current: View =
    tab === "results"
      ? "results"
      : tab === "board"
        ? "board"
        : tab === "history"
          ? "history"
          : tab === "about"
            ? "about"
            : tab === "new-research"
              ? "new-research"
              : "main";
  const chatId = tab === "chats" && item ? item : w?.session_id || "";
  const conversation = current === "main" || (current === "history" && !!item);
  const refresh = useCallback(() => setReads((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    getWorkspace(id).then(
      (workspace) => {
        if (!cancelled) {
          setW(workspace);
          setFailed("");
        }
      },
      (error: unknown) => {
        if (!cancelled)
          setFailed(error instanceof Error ? error.message : String(error));
      },
    );
    workspaceNotes(id).then(
      (rows) => !cancelled && setNotes(rows),
      () => undefined,
    );
    if (current === "board")
      getBoard(id).then((board) => {
        if (!cancelled) {
          setCards(board.cards);
          setColumns(board.columns);
        }
      }, fail);
    return () => {
      cancelled = true;
    };
  }, [id, reads, current]);

  useEffect(() => {
    const timer = window.setInterval(() => !document.hidden && refresh(), POLL);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(
      async () => {
        setListing(true);
        try {
          const all: ProjectSession[] = [];
          let cursor: string | undefined;
          let next: string | null = null;
          for (let page = 0; page < pages; page++) {
            const result = await listProjectSessions(id, {
              search,
              archived,
              cursor,
            });
            all.push(...result.items);
            next = result.next_cursor;
            if (!next) break;
            cursor = next;
          }
          if (!cancelled) {
            setSessions(all);
            setMore(!!next);
            setListError("");
          }
        } catch (error) {
          if (!cancelled)
            setListError(
              error instanceof Error ? error.message : String(error),
            );
        } finally {
          if (!cancelled) setListing(false);
        }
      },
      search ? 180 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [id, search, archived, pages, reads]);

  useEffect(() => {
    if (!conversation || !chatId) return;
    let cancelled = false;
    setSelected((old) => (old?.id === chatId ? old : null));
    getChatSession(chatId).then((session) => {
      if (!cancelled && session.workspace_id === id) {
        if (session.kind === "research" && session.research_id)
          go(`research/${session.research_id}`);
        else setSelected(session);
      }
    }, fail);
    return () => {
      cancelled = true;
    };
  }, [chatId, id, conversation, reads, go]);

  const newChat = async () => {
    setOpening(true);
    try {
      const chat = await createProjectChat(id);
      setRailOpen(false);
      go(`projects/${id}/chats/${chat.id}`);
      refresh();
    } catch (error) {
      fail(error);
    } finally {
      setOpening(false);
    }
  };
  const change = async (
    session: ProjectSession,
    body: { pinned?: boolean; archived?: boolean; title?: string },
  ) => {
    try {
      await updateChatSession(session.id, body);
      if (body.archived && chatId === session.id) go(`projects/${id}`);
      refresh();
    } catch (error) {
      fail(error);
    }
  };
  const sessionList = (full = false) => (
    <SessionList
      full={full}
      sessions={sessions}
      currentId={conversation ? chatId : ""}
      search={search}
      onSearch={(value) => {
        setSearch(value);
        setPages(1);
      }}
      archived={archived}
      onArchived={(value) => {
        setArchived(value);
        setPages(1);
      }}
      more={more}
      loading={listing}
      error={listError}
      onMore={() => setPages((n) => n + 1)}
      onNew={newChat}
      opening={opening}
      onResearch={() => {
        setRailOpen(false);
        go(`projects/${id}/new-research`);
      }}
      onName={(session) => {
        setNaming(session);
        setTitle(session.title);
      }}
      onChange={change}
      go={(hash) => {
        setRailOpen(false);
        go(hash);
      }}
    />
  );

  if (!w)
    return (
      <div className={styles.page}>
        <div className={styles.inner}>{failed || <Spinner />}</div>
      </div>
    );
  return (
    <div className={styles.page}>
      <header className={styles.projectHead}>
        <IconButton
          icon={ArrowLeft}
          label={t("projects.back")}
          size="sm"
          onClick={() => go("projects")}
        />
        <div className={styles.projectTitle}>
          <h1>{w.name}</h1>
        </div>
        <SegmentedControl
          kind="radio"
          size="sm"
          label={t("projects.view")}
          value={
            current === "board" || current === "results"
              ? current
              : conversation && chatId === w.session_id
                ? "main"
                : ""
          }
          onChange={(next) => {
            setRailOpen(false);
            go(next === "main" ? `projects/${id}` : `projects/${id}/${next}`);
          }}
          options={[
            { value: "main", label: t("projects.view.main") },
            { value: "board", label: t("projects.view.board") },
            { value: "results", label: t("projects.view.results") },
          ]}
        />
        <Menu
          label={t("projects.actions")}
          items={[
            {
              id: "sessions",
              label: t("projects.sessions"),
              icon: PanelLeftOpen,
              onSelect: () => {
                setRailOpen(false);
                go(`projects/${id}/history`);
              },
            },
            {
              id: "settings",
              label: t("projects.view.about"),
              icon: Settings,
              onSelect: () => {
                setRailOpen(false);
                go(`projects/${id}/about`);
              },
            },
          ]}
          trigger={(props) => (
            <IconButton
              icon={MoreHorizontal}
              label={t("projects.actions")}
              size="sm"
              {...props}
            />
          )}
        />
      </header>
      <div className={styles.panel}>
        {conversation && chatId && (
          <div className={styles.main}>
            <div
              className={styles.sessionRail}
              data-open={railOpen || undefined}
            >
              <div className={styles.railClose}>
                <IconButton
                  icon={PanelLeftClose}
                  label={t("common.close")}
                  size="sm"
                  onClick={() => setRailOpen(false)}
                />
              </div>
              {sessionList()}
            </div>
            {railOpen && (
              <button
                className={styles.railBackdrop}
                aria-label={t("common.close")}
                onClick={() => setRailOpen(false)}
              />
            )}
            <div className={styles.conversation}>
              <button
                className={styles.railToggle}
                type="button"
                onClick={() => setRailOpen(true)}
              >
                <PanelLeftOpen size={15} aria-hidden />
                {t("projects.sessions")}
              </button>
              <ProjectChat
                key={chatId}
                workspace={w}
                chatId={chatId}
                main={chatId === w.session_id}
                session={selected}
                notes={chatId === w.session_id ? notes : []}
                researches={w.researches}
                refreshKey={reads}
                onChanged={refresh}
                onNew={newChat}
                go={go}
              />
            </div>
          </div>
        )}
        {current === "board" && (
          <Board
            workspace={w}
            columns={columns}
            cards={cards}
            go={go}
            refresh={refresh}
          />
        )}
        {current === "history" && !item && (
          <div className={styles.sessionPage}>{sessionList(true)}</div>
        )}
        {current === "new-research" && (
          <div className={styles.newResearch}>
            <h2>{t("projects.newResearch")}</h2>
            <NewResearch workspace={w} go={go} />
          </div>
        )}
        {current === "results" && (
          <ProjectResults workspaceId={id} refreshKey={reads} go={go} />
        )}
        {current === "about" && (
          <div className={styles.projectSettings}>
            <About workspace={w} onSaved={refresh} />
          </div>
        )}
      </div>
      <Dialog
        open={!!naming}
        onClose={() => setNaming(null)}
        title={t("projects.sessions.rename")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setNaming(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={!title.trim()}
              onClick={async () => {
                if (naming) await change(naming, { title: title.trim() });
                setNaming(null);
              }}
            >
              {t("projects.save")}
            </Button>
          </>
        }
      >
        <TextField
          label={t("projects.sessions.title")}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Dialog>
    </div>
  );
}

function fail(error: unknown) {
  toast.show({
    message: error instanceof Error ? error.message : String(error),
    tone: "error",
  });
}

/** The board: every research, its hypotheses and experiments, and the ideas, by column. */
function Board({
  workspace,
  columns,
  cards,
  go,
  refresh,
}: {
  workspace: Workspace;
  columns: Column[];
  cards: BoardCard[];
  go(hash: string): void;
  refresh(): void;
}) {
  const { t } = useI18n();
  const [idea, setIdea] = useState("");
  const [over, setOver] = useState<Column | "">("");
  const strip = useRef<HTMLDivElement>(null);
  // How many cards sit in the columns past each edge.
  const [past, setPast] = useState({ left: 0, right: 0 });

  const measure = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    let left = 0;
    let right = 0;
    for (const column of Array.from(el.children) as HTMLElement[]) {
      const rect = column.getBoundingClientRect();
      const n = Number(column.dataset.count) || 0;
      if (rect.right <= box.left + 24) left += n || 0.001;
      else if (rect.left >= box.right - 24) right += n || 0.001;
    }
    setPast({ left, right });
  }, []);

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [measure, cards.length]);

  // Pressing on the board's background and dragging pans it, as on a desk.
  const pan = useRef<{ x: number; left: number; id: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const grab = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = strip.current;
    if (!el || event.button !== 0) return;
    if (
      (event.target as HTMLElement).closest(
        "article, button, input, textarea, a, form, [draggable='true']",
      )
    )
      return;
    pan.current = {
      x: event.clientX,
      left: el.scrollLeft,
      id: event.pointerId,
    };
    el.setPointerCapture(event.pointerId);
    setPanning(true);
  };
  const drag = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = strip.current;
    if (!el || !pan.current) return;
    el.scrollLeft = pan.current.left - (event.clientX - pan.current.x);
  };
  const release = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pan.current && strip.current?.hasPointerCapture(event.pointerId))
      strip.current.releasePointerCapture(event.pointerId);
    pan.current = null;
    setPanning(false);
  };

  const turn = (direction: 1 | -1) => {
    const el = strip.current;
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({
      left: direction * el.clientWidth * 0.8,
      behavior: still ? "auto" : "smooth",
    });
  };

  // A mouse wheel turns the board sideways, unless a column under the pointer
  // still has its own cards to scroll that way.
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const list = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-cards]",
      );
      if (
        list &&
        ((event.deltaY > 0 &&
          list.scrollTop + list.clientHeight < list.scrollHeight - 1) ||
          (event.deltaY < 0 && list.scrollTop > 0))
      )
        return;
      if (el.scrollWidth <= el.clientWidth) return;
      event.preventDefault();
      el.scrollLeft += event.deltaY;
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const hand: Column[] = ["triage", "todo", "dropped"];

  const drop = async (column: Column, cardId: string) => {
    setOver("");
    if (!hand.includes(column)) return;
    try {
      await moveCard(cardId, column);
      refresh();
    } catch (error) {
      fail(error);
    }
  };

  return (
    <div className={styles.boardWrap}>
      {past.left > 0 && (
        <button
          type="button"
          className={styles.more}
          data-side="left"
          aria-label={t("projects.moreLeft")}
          onClick={() => turn(-1)}
        >
          <ChevronLeft size={14} aria-hidden />
          {Math.floor(past.left) > 0 && Math.floor(past.left)}
        </button>
      )}
      {past.right > 0 && (
        <button
          type="button"
          className={styles.more}
          data-side="right"
          aria-label={t("projects.moreRight")}
          onClick={() => turn(1)}
        >
          {Math.floor(past.right) > 0 && Math.floor(past.right)}
          <ChevronRight size={14} aria-hidden />
        </button>
      )}
      <div
        className={styles.board}
        ref={strip}
        data-panning={panning || undefined}
        onPointerDown={grab}
        onPointerMove={drag}
        onPointerUp={release}
        onPointerCancel={release}
      >
        {columns.map((column) => {
          const here = cards.filter((c) => c.column === column);
          return (
            <section
              key={column}
              className={styles.column}
              data-column={column}
              data-count={here.length}
              data-over={over === column || undefined}
              onDragOver={(event) => {
                if (hand.includes(column)) {
                  event.preventDefault();
                  setOver(column);
                }
              }}
              onDragLeave={() => setOver("")}
              onDrop={(event) =>
                drop(column, event.dataTransfer.getData("text/card"))
              }
            >
              <header className={styles.columnHead}>
                <span className={styles.columnDot} data-column={column} />
                {t(`projects.column.${column}` as MessageKey)}
                <span className={styles.count}>{here.length}</span>
              </header>
              {column === "triage" && (
                <form
                  className={styles.ideaForm}
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (!idea.trim()) return;
                    try {
                      await addCard(workspace.id, idea.trim());
                      setIdea("");
                      refresh();
                    } catch (error) {
                      fail(error);
                    }
                  }}
                >
                  <Plus size={14} aria-hidden />
                  <input
                    value={idea}
                    placeholder={t("projects.ideaPlaceholder")}
                    aria-label={t("projects.ideaPlaceholder")}
                    onChange={(e) => setIdea(e.target.value)}
                  />
                </form>
              )}
              <div className={styles.cards} data-cards>
                {here.map((card) => (
                  <CardFace
                    key={card.id}
                    card={card}
                    go={go}
                    refresh={refresh}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function CardFace({
  card,
  go,
  refresh,
}: {
  card: BoardCard;
  go(hash: string): void;
  refresh(): void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const Icon = KIND_ICON[card.kind];
  const open = () => card.research && go(`research/${card.research.id}`);
  return (
    <article
      className={styles.card}
      data-column={card.column}
      data-live={card.working ? true : undefined}
      draggable={card.movable}
      onDragStart={(event) => event.dataTransfer.setData("text/card", card.id)}
    >
      <button
        type="button"
        className={styles.cardBody}
        disabled={!card.research}
        onClick={open}
      >
        <span className={styles.cardKind}>
          <Icon size={13} aria-hidden />
          {t(`projects.kind.${card.kind}` as MessageKey)}
          {card.best && (
            <span className={styles.cardMetric}>
              {card.best.name} {card.best.value.toPrecision(4)}
            </span>
          )}
        </span>
        <span className={styles.cardTitle}>{card.title}</span>
        {card.summary && (
          <span className={styles.cardSummary}>{card.summary}</span>
        )}
      </button>
      {(card.working || (card.research && card.kind !== "research")) && (
        <footer className={styles.cardFoot}>
          {card.working && (
            <span className={styles.working}>
              <Mascot
                agent={
                  card.working === "scoping"
                    ? "advisor"
                    : (card.working as "executor")
                }
                size={16}
                pose="work"
              />
              {t(
                `research.role.${card.working === "scoping" ? "advisor" : card.working}` as MessageKey,
              )}
            </span>
          )}
          {card.research && card.kind !== "research" && (
            <span
              className={styles.cardResearch}
              title={card.research.question}
            >
              {card.research.question}
            </span>
          )}
        </footer>
      )}
      {card.kind === "idea" && card.column !== "dropped" && (
        <footer className={styles.cardFoot}>
          <Button
            size="sm"
            variant="ghost"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const research = await startCard(card.id);
                go(`research/${research.id}`);
              } catch (error) {
                fail(error);
                setBusy(false);
                refresh();
              }
            }}
          >
            {t("projects.startResearch")}
          </Button>
        </footer>
      )}
    </article>
  );
}

/** Where a new research begins: one sentence, then a talk with the advisor. */
function NewResearch({
  workspace,
  go,
}: {
  workspace: Workspace;
  go(hash: string): void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [modelId, setModelId] = useState(workspace.model_config_id);
  const [computes, setComputes] = useState<Compute[]>([]);
  const [computeId, setComputeId] = useState(workspace.compute_id);

  useEffect(() => {
    readModels().then(
      (s) => {
        setModels(s.models);
        setModelId((m) => m || s.active_id || s.models[0]?.id || "");
      },
      () => undefined,
    );
    readResearchSettings().then(
      (s) => {
        setComputes(s.computes);
        setComputeId((c) => c || s.default_compute);
      },
      () => undefined,
    );
  }, []);

  return (
    <Composer
      value={text}
      onChange={setText}
      busy={busy}
      label={t("projects.newResearch")}
      placeholder={t("projects.newResearchPlaceholder")}
      sendLabel={t("research.home.send")}
      onSend={async () => {
        setBusy(true);
        try {
          const p = await startProject({
            message: text.trim(),
            model_config_id: modelId,
            compute_id: computeId || undefined,
            workspace_id: workspace.id,
          });
          go(`research/${p.id}`);
        } catch (error) {
          fail(error);
          setBusy(false);
        }
      }}
      tools={
        <>
          <ModelPicker
            models={models}
            value={modelId}
            onChange={setModelId}
            label={t("research.home.model")}
          />
          {computes.length > 1 && (
            <ComputePicker
              computes={computes}
              value={computeId}
              onChange={setComputeId}
              label={t("research.home.compute")}
            />
          )}
        </>
      }
    />
  );
}

function SessionList({
  full,
  sessions,
  currentId,
  search,
  onSearch,
  archived,
  onArchived,
  more,
  loading,
  error,
  onMore,
  onNew,
  opening,
  onResearch,
  onName,
  onChange,
  go,
}: {
  full: boolean;
  sessions: ProjectSession[];
  currentId: string;
  search: string;
  onSearch(value: string): void;
  archived: boolean;
  onArchived(value: boolean): void;
  more: boolean;
  loading: boolean;
  error: string;
  onMore(): void;
  onNew(): void;
  opening: boolean;
  onResearch(): void;
  onName(session: ProjectSession): void;
  onChange(
    session: ProjectSession,
    body: { pinned?: boolean; archived?: boolean },
  ): void;
  go(hash: string): void;
}) {
  const { t } = useI18n();
  return (
    <nav
      className={styles.sessions}
      aria-label={t("projects.sessions")}
      data-full={full || undefined}
    >
      <div className={styles.sessionActions}>
        <Button
          size="sm"
          variant="ghost"
          icon={MessageSquarePlus}
          loading={opening}
          onClick={onNew}
        >
          {t("projects.newChat")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={Microscope}
          onClick={onResearch}
        >
          {t("projects.newResearch")}
        </Button>
      </div>
      <label className={styles.sessionSearch}>
        <Search size={14} aria-hidden />
        <input
          type="search"
          aria-label={t("projects.sessions.search")}
          placeholder={t("projects.sessions.search")}
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </label>
      <div className={styles.sessionFilter}>
        <span>
          {t(archived ? "projects.sessions.archived" : "projects.sessions")}
        </span>
        <IconButton
          size="sm"
          icon={archived ? ArchiveRestore : Archive}
          label={t(
            archived
              ? "projects.sessions.active"
              : "projects.sessions.archived",
          )}
          onClick={() => onArchived(!archived)}
        />
      </div>
      {error && <p className={styles.sessionError}>{error}</p>}
      <ul className={styles.sessionRows}>
        {sessions.map((session) => {
          const hash =
            session.kind === "research" && session.research_id
              ? `research/${session.research_id}`
              : session.kind === "project_lead"
                ? `projects/${session.workspace_id}`
                : `projects/${session.workspace_id}/chats/${session.id}`;
          const role =
            session.kind === "project_lead"
              ? "projects.lead"
              : session.kind === "research"
                ? "projects.kind.research"
                : "projects.kind.chat";
          const status =
            session.status === "active"
              ? "projects.column.running"
              : session.status === "waiting"
                ? "projects.column.review"
                : session.status === "paused"
                  ? "projects.sessions.paused"
                  : session.status === "finished"
                    ? "projects.column.done"
                    : session.status === "queued"
                      ? "projects.sessions.queued"
                      : session.status === "running"
                        ? "projects.sessions.running"
                        : session.status === "failed"
                          ? "projects.notes.error"
                          : session.status === "cancelled"
                            ? "projects.sessions.cancelled"
                            : "projects.sessions.idle";
          const menu = [
            ...(session.capabilities.rename
              ? [
                  {
                    id: "rename",
                    label: t("projects.sessions.rename"),
                    icon: Pencil,
                    onSelect: () => onName(session),
                  },
                ]
              : []),
            ...(session.capabilities.pin
              ? [
                  {
                    id: "pin",
                    label: t(
                      session.pinned_at
                        ? "projects.sessions.unpin"
                        : "projects.sessions.pin",
                    ),
                    icon: session.pinned_at ? PinOff : Pin,
                    onSelect: () =>
                      onChange(session, { pinned: !session.pinned_at }),
                  },
                ]
              : []),
            ...(session.capabilities.archive || session.archived_at
              ? [
                  {
                    id: "archive",
                    label: t(
                      session.archived_at
                        ? "projects.sessions.restore"
                        : "projects.sessions.archive",
                    ),
                    icon: session.archived_at ? ArchiveRestore : Archive,
                    onSelect: () =>
                      onChange(session, { archived: !session.archived_at }),
                  },
                ]
              : []),
          ];
          return (
            <li
              key={session.id}
              className={styles.sessionRow}
              data-current={session.id === currentId || undefined}
            >
              <a
                href={`#${hash}`}
                onClick={followLink(go, hash)}
                aria-current={session.id === currentId ? "page" : undefined}
                className={styles.sessionLink}
              >
                <span className={styles.sessionTitle}>
                  {session.pinned_at && <Pin size={11} aria-hidden />}
                  {session.title || session.question || t(role)}
                </span>
                <span className={styles.sessionMeta}>
                  <span>{t(role)}</span>
                  <span
                    data-live={
                      session.status === "running" ||
                      session.status === "active" ||
                      undefined
                    }
                  >
                    {t(status)}
                  </span>
                </span>
                {session.forked_from?.research_id && (
                  <span className={styles.sessionProgress}>
                    ↳{" "}
                    {session.forked_from.question ||
                      session.forked_from.research_id}{" "}
                    ·{" "}
                    {t("research.sprint", {
                      number: session.forked_from.number,
                    })}
                  </span>
                )}
                {(session.merged?.memory || session.merged?.code) && (
                  <span className={styles.sessionProgress}>
                    {t("research.merge.applied")}
                  </span>
                )}
                {session.progress && (
                  <span className={styles.sessionProgress}>
                    {session.progress.replace(/^#{1,6}\s+/, "")}
                  </span>
                )}
              </a>
              {menu.length > 0 && (
                <Menu
                  label={t("projects.sessions.actions")}
                  items={menu}
                  trigger={(props) => (
                    <IconButton
                      icon={MoreHorizontal}
                      label={t("projects.sessions.actions")}
                      size="sm"
                      {...props}
                    />
                  )}
                />
              )}
            </li>
          );
        })}
      </ul>
      {!sessions.length && !loading && !error && (
        <p className={styles.sessionEmpty}>{t("projects.sessions.empty")}</p>
      )}
      {loading && !sessions.length && <Spinner />}
      {more && (
        <Button size="sm" variant="ghost" loading={loading} onClick={onMore}>
          {t("projects.sessions.more")}
        </Button>
      )}
    </nav>
  );
}

/** Beside the conversations: what every agent in the project is told, and its defaults. */
export function About({
  workspace,
  onSaved,
}: {
  workspace: Workspace;
  onSaved(): void;
}) {
  const { t } = useI18n();
  const { connections } = useResearchNavigation();
  const machine = workspaceMachine(
    workspace.location,
    connections,
    t("workspace.local"),
    t("workspace.remote"),
  );
  const [draft, setDraft] = useState(workspace);
  const [editing, setEditing] = useState(false);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [computes, setComputes] = useState<Compute[]>([]);
  useEffect(() => {
    readModels().then(
      (s) => setModels(s.models),
      () => undefined,
    );
    readResearchSettings().then(
      (s) => setComputes(s.computes),
      () => undefined,
    );
  }, []);
  const save = async (body: Partial<Workspace>) => {
    try {
      setDraft({ ...draft, ...(await updateWorkspace(workspace.id, body)) });
      onSaved();
    } catch (error) {
      fail(error);
    }
  };
  return (
    <aside className={styles.about}>
      <section>
        <h2>{t("projects.instructions")}</h2>
        <TextArea
          label={t("projects.instructions")}
          hideLabel
          rows={6}
          value={draft.instructions}
          onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
          onBlur={() =>
            draft.instructions !== workspace.instructions &&
            save({ instructions: draft.instructions })
          }
        />
      </section>
      <section>
        <h2>{t("projects.defaults")}</h2>
        <div className={styles.defaults}>
          <ModelPicker
            models={models}
            value={draft.model_config_id}
            onChange={(model_config_id) => save({ model_config_id })}
            label={t("research.home.model")}
          />
          {workspace.location?.kind === "local" ||
          workspace.location?.kind === "ssh" ? (
            <span title={workspace.location.path}>{machine.label}</span>
          ) : (
            <ComputePicker
              computes={computes}
              value={draft.compute_id}
              onChange={(compute_id) => save({ compute_id })}
              label={t("research.home.compute")}
            />
          )}
        </div>
      </section>
      <section className={styles.aboutActions}>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          {t("projects.edit")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => save({ archived: !draft.archived })}
        >
          {t(draft.archived ? "projects.unarchive" : "projects.archive")}
        </Button>
      </section>
      <Dialog
        open={editing}
        onClose={() => setEditing(false)}
        title={t("projects.edit")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={!draft.name.trim()}
              onClick={async () => {
                await save({
                  name: draft.name,
                  description: draft.description,
                });
                setEditing(false);
              }}
            >
              {t("projects.save")}
            </Button>
          </>
        }
      >
        <div className={styles.files}>
          <TextField
            label={t("projects.name")}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <TextArea
            label={t("projects.about")}
            rows={2}
            value={draft.description}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
          />
        </div>
      </Dialog>
    </aside>
  );
}
