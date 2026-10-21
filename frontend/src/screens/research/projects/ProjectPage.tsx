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
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import type { MessageKey } from "../../../i18n/i18n";
import { followLink } from "../../../reader/route";
import {
  Button,
  Dialog,
  IconButton,
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
  listChats,
  moveCard,
  readResearchSettings,
  startCard,
  startProject,
  updateWorkspace,
  type BoardCard,
  type Column,
  type Compute,
  type ProjectChat as ProjectChatRow,
  type ResearchSummary,
  type Workspace,
} from "../research-api";
import { Mascot } from "../scene/Mascot";
import { Composer } from "../talk/Composer";
import { ComputePicker, ModelPicker } from "../talk/Pickers";
import { ProjectChat } from "./ProjectChats";
import styles from "./Projects.module.css";

/** The board is a second view; chats/<id> opens an earlier conversation. */
type View = "overview" | "board" | "chats";
const POLL = 4000;

const KIND_ICON = {
  research: Microscope,
  hypothesis: Target,
  experiment: FlaskConical,
  finding: Sparkles,
  idea: Lightbulb,
} as const;

/** A project: its board, its researches, and what they share. */
export function ProjectPage({
  id,
  tab,
  item,
  go,
}: {
  id: string;
  tab?: string;
  /** A conversation open in the chats tab. */
  item?: string;
  go(hash: string): void;
}) {
  const { t } = useI18n();
  const [w, setW] = useState<
    (Workspace & { researches: ResearchSummary[] }) | null
  >(null);
  const [cards, setCards] = useState<BoardCard[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [reads, setReads] = useState(0);
  const [failed, setFailed] = useState("");
  const current: View =
    tab === "board" ? "board" : tab === "chats" && item ? "chats" : "overview";

  useEffect(() => {
    Promise.all([getWorkspace(id), getBoard(id)]).then(
      ([workspace, board]) => {
        setW(workspace);
        setCards(board.cards);
        setColumns(board.columns);
      },
      (error: unknown) =>
        setFailed(error instanceof Error ? error.message : String(error)),
    );
  }, [id, reads]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => !document.hidden && setReads((n) => n + 1),
      POLL,
    );
    return () => window.clearTimeout(timer);
  }, [reads]);

  const refresh = useCallback(() => setReads((n) => n + 1), []);

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
          {w.description && <p>{w.description}</p>}
        </div>
        <SegmentedControl
          kind="radio"
          size="sm"
          label={t("projects.view")}
          value={current === "board" ? "board" : "overview"}
          onChange={(next) =>
            go(next === "board" ? `projects/${id}/board` : `projects/${id}`)
          }
          options={[
            { value: "overview", label: t("projects.view.list") },
            { value: "board", label: t("projects.view.board") },
          ]}
        />
      </header>
      <div className={styles.panel}>
        {current === "board" &&
          (w.researches.length > 0 || cards.length > 0 ? (
            <Board
              workspace={w}
              columns={columns}
              cards={cards}
              go={go}
              refresh={refresh}
            />
          ) : (
            <p className={styles.empty}>{t("projects.noResearch")}</p>
          ))}
        {current === "chats" && item && (
          <ProjectChat key={item} workspace={w} chatId={item} go={go} />
        )}
        {current === "overview" && (
          <div className={styles.overview}>
            <Conversations workspace={w} go={go} />
            <About workspace={w} onSaved={refresh} />
          </div>
        )}
      </div>
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

const STAGE_KEY = (s: string) => `research.stage.${s}` as MessageKey;

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

/** Everything said in the project, latest first: researches and conversations. */
function Conversations({
  workspace,
  go,
}: {
  workspace: Workspace & { researches: ResearchSummary[] };
  go(hash: string): void;
}) {
  const { t, locale } = useI18n();
  const [chats, setChats] = useState<ProjectChatRow[]>([]);
  useEffect(() => {
    listChats(workspace.id).then(setChats, () => setChats([]));
  }, [workspace.id]);
  const when = (stamp: string) =>
    new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(stamp));
  const rows = [
    ...workspace.researches.map((r) => ({
      key: r.id,
      hash: `research/${r.id}`,
      title: r.question,
      at: r.updated_at,
      column: r.column as string,
      status:
        r.column === "running" || r.column === "todo"
          ? t(STAGE_KEY(r.stage))
          : t(`projects.column.${r.column}` as MessageKey),
      line: r.column === "done" ? r.conclusion || r.said : r.said,
    })),
    ...chats.map((c) => ({
      key: c.id,
      hash: `projects/${workspace.id}/chats/${c.id}`,
      title: c.title,
      at: c.updated_at,
      column: "chat",
      status: t("projects.kind.chat"),
      line: "",
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className={styles.conversations}>
      <NewResearch workspace={workspace} go={go} />
      {rows.length > 0 && (
        <ul className={styles.rows}>
          {rows.map((r) => (
            <li key={r.key}>
              <a
                href={`#${r.hash}`}
                className={styles.row}
                onClick={followLink(go, r.hash)}
              >
                <span className={styles.rowQuestion}>{r.title}</span>
                <span className={styles.rowFacts}>
                  <span className={styles.badge} data-column={r.column}>
                    {r.status}
                  </span>
                  <span>{when(r.at)}</span>
                </span>
                {r.line && <span className={styles.rowLine}>{r.line}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Beside the conversations: what every agent in the project is told, and its defaults. */
function About({
  workspace,
  onSaved,
}: {
  workspace: Workspace;
  onSaved(): void;
}) {
  const { t } = useI18n();
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
          placeholder={t("projects.instructionsPlaceholder")}
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
          <ComputePicker
            computes={computes}
            value={draft.compute_id}
            onChange={(compute_id) => save({ compute_id })}
            label={t("research.home.compute")}
          />
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
