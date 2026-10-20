import {
  ArrowLeft,
  FlaskConical,
  Lightbulb,
  Microscope,
  Plus,
  Sparkles,
  Target,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import type { MessageKey } from "../../../i18n/i18n";
import { followLink } from "../../../reader/route";
import {
  Button,
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
  moveCard,
  readResearchSettings,
  startCard,
  startProject,
  updateWorkspace,
  type BoardCard,
  type Column,
  type Compute,
  type ResearchSummary,
  type Workspace,
} from "../research-api";
import { Mascot } from "../scene/Mascot";
import { Composer } from "../talk/Composer";
import { ComputePicker, ModelPicker } from "../talk/Pickers";
import styles from "./Projects.module.css";

type Tab = "board" | "researches" | "files";
const TABS: Tab[] = ["board", "researches", "files"];
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
  go,
}: {
  id: string;
  tab?: string;
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
  const current: Tab = TABS.includes(tab as Tab) ? (tab as Tab) : "board";

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
          kind="tabs"
          size="sm"
          label={t("projects.tabs")}
          value={current}
          onChange={(next) => go(`projects/${id}/${next}`)}
          options={TABS.map((value) => ({
            value,
            label: t(`projects.tab.${value}` as MessageKey),
            panelId: `project-${value}`,
          }))}
        />
      </header>
      <div
        className={styles.panel}
        id={`project-${current}`}
        role="tabpanel"
        aria-labelledby={`project-${current}-tab`}
      >
        {current === "board" && (
          <Board
            workspace={w}
            columns={columns}
            cards={cards}
            go={go}
            refresh={refresh}
          />
        )}
        {current === "researches" && <Researches workspace={w} go={go} />}
        {current === "files" && <Files workspace={w} onSaved={refresh} />}
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
    <div className={styles.board}>
      {columns.map((column) => {
        const here = cards.filter((c) => c.column === column);
        return (
          <section
            key={column}
            className={styles.column}
            data-column={column}
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
            <div className={styles.cards}>
              {here.map((card) => (
                <CardFace key={card.id} card={card} go={go} refresh={refresh} />
              ))}
            </div>
          </section>
        );
      })}
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

/** The researches of the project, and where a new one begins. */
function Researches({
  workspace,
  go,
}: {
  workspace: Workspace & { researches: ResearchSummary[] };
  go(hash: string): void;
}) {
  const { t, locale } = useI18n();
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

  const when = (stamp: string) =>
    new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(stamp));

  return (
    <div className={styles.researches}>
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
      {workspace.researches.length === 0 ? (
        <p className={styles.empty}>{t("projects.noResearch")}</p>
      ) : (
        <ul className={styles.rows}>
          {workspace.researches.map((r) => (
            <li key={r.id}>
              <a
                href={`#research/${r.id}`}
                className={styles.row}
                onClick={followLink(go, `research/${r.id}`)}
              >
                <span className={styles.columnDot} data-column={r.column} />
                <span className={styles.rowQuestion}>{r.question}</span>
                <span className={styles.rowFacts}>
                  <span>{t(STAGE_KEY(r.stage))}</span>
                  {r.best && (
                    <span className={styles.cardMetric}>
                      {r.best.name} {r.best.value.toPrecision(4)}
                    </span>
                  )}
                  {r.waiting > 0 && (
                    <span className={styles.badge} data-tone="you">
                      {t("projects.waiting", { n: r.waiting })}
                    </span>
                  )}
                  <span>{when(r.updated_at)}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What the researches of the project share. */
function Files({
  workspace,
  onSaved,
}: {
  workspace: Workspace;
  onSaved(): void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(workspace);
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    try {
      setDraft({ ...draft, ...(await updateWorkspace(workspace.id, body)) });
      onSaved();
      toast.show({ message: t("projects.saved") });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };
  return (
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
        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
      />
      <TextArea
        label={t("projects.instructions")}
        description={t("projects.instructionsHint")}
        rows={8}
        value={draft.instructions}
        placeholder={t("projects.instructionsPlaceholder")}
        onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
      />
      <div className={styles.defaults}>
        <span className={styles.defaultsLabel}>{t("projects.defaults")}</span>
        <ModelPicker
          models={models}
          value={draft.model_config_id}
          onChange={(model_config_id) =>
            setDraft({ ...draft, model_config_id })
          }
          label={t("research.home.model")}
        />
        <ComputePicker
          computes={computes}
          value={draft.compute_id}
          onChange={(compute_id) => setDraft({ ...draft, compute_id })}
          label={t("research.home.compute")}
        />
      </div>
      <div className={styles.actions}>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => save({ archived: !draft.archived })}
        >
          {t(draft.archived ? "projects.unarchive" : "projects.archive")}
        </Button>
        <Button
          variant="primary"
          loading={busy}
          onClick={() =>
            save({
              name: draft.name,
              description: draft.description,
              instructions: draft.instructions,
              model_config_id: draft.model_config_id,
              compute_id: draft.compute_id,
            })
          }
        >
          {t("projects.save")}
        </Button>
      </div>
    </div>
  );
}
