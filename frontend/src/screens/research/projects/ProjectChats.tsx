import { Pencil, Square } from "lucide-react";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { AppActions } from "../../../app/AppSidebar";
import type { SlashCommand } from "../../../lib/slash";
import { followLink } from "../../../reader/route";
import { JumpToLatest } from "../../../reader/JumpToLatest";
import { useI18n } from "../../../i18n/I18nProvider";
import {
  Button,
  Dialog,
  IconButton,
  Menu,
  Spinner,
  TextField,
  toast,
} from "../../../ui";
import { RunTurn } from "../process/Process";
import { isLive } from "../process/model";
import { readModels, type ModelRow } from "../../setup/model-api";
import {
  askChat,
  chatControls,
  chatTurns,
  cloneChat,
  controlChat,
  renameChat,
  type ChatControl,
  type ChatTurn,
  type ProjectSession,
  type ResearchNote,
  type ResearchSummary,
  type Workspace,
} from "../research-api";
import {
  contextStatus,
  copyCommand,
  modelCommands,
} from "../../../lib/composer-commands";
import { Composer } from "../talk/Composer";
import { ModelPicker } from "../talk/Pickers";
import talk from "../talk/Talk.module.css";
import styles from "./Projects.module.css";

const POLL = 1500;
function fail(error: unknown) {
  toast.show({
    message: error instanceof Error ? error.message : String(error),
    tone: "error",
  });
}
function savedDraft(key: string): { text: string; model: string } {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    return {
      text: typeof value.text === "string" ? value.text : "",
      model: typeof value.model === "string" ? value.model : "",
    };
  } catch {
    return { text: "", model: "" };
  }
}

export function ProjectChat({
  workspace,
  chatId,
  main = false,
  session,
  notes = [],
  researches = [],
  refreshKey = 0,
  onChanged,
  onNew,
  go,
}: {
  workspace: Workspace;
  chatId: string;
  main?: boolean;
  session?: ProjectSession | null;
  notes?: ResearchNote[];
  researches?: ResearchSummary[];
  refreshKey?: number;
  onChanged?(): void;
  onNew(): void | Promise<void>;
  go(hash: string): void;
}) {
  const { t } = useI18n();
  const { owner } = useContext(AppActions);
  const draftKey = `ora-project-draft:${owner || "local"}:${chatId}`;
  const [draft, setDraft] = useState(() => savedDraft(draftKey));
  const draftNow = useRef(draft);
  draftNow.current = draft;
  const [turns, setTurns] = useState<ChatTurn[] | null>(null);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [reads, setReads] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [controls, setControls] = useState<ChatControl[]>([]);
  const [delivery, setDelivery] = useState<"steer" | "follow_up">("steer");
  const [models, setModels] = useState<ModelRow[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const active = [...(turns || [])].reverse().find(isLive);
  const latest = turns?.at(-1);
  const live = !!active;
  const stopRequested = stopping || active?.runtime.phase === "stopping";
  const canSend = !!session?.capabilities.send && !session.archived_at;
  const canSteer = !!session?.capabilities.steer;
  const modelId =
    draft.model ||
    latest?.model_config_id ||
    session?.model_config_id ||
    workspace.model_config_id ||
    defaultModel;
  const chatTitle =
    session?.title || t(main ? "projects.lead" : "projects.newChat");
  const saveDraft = (body: Partial<typeof draft>) => {
    const next = { ...draftNow.current, ...body };
    draftNow.current = next;
    try {
      localStorage.setItem(draftKey, JSON.stringify(next));
    } catch {
      /* Drafts stay available in memory when storage is unavailable. */
    }
    setDraft(next);
  };
  useEffect(() => {
    readModels().then(
      (s) => {
        setModels(s.models);
        setDefaultModel(s.active_id || s.models[0]?.id || "");
      },
      () => setModels([]),
    );
  }, []);
  const read = useCallback(
    () =>
      chatTurns(chatId).then(
        (rows) => {
          setTurns(rows);
          setLoadError("");
        },
        (error: unknown) =>
          setLoadError(error instanceof Error ? error.message : String(error)),
      ),
    [chatId],
  );
  useEffect(() => {
    void read();
  }, [read, reads, refreshKey]);
  useEffect(() => {
    if (!live) {
      setStopping(false);
      return;
    }
    const timer = window.setTimeout(() => setReads((n) => n + 1), POLL);
    return () => window.clearTimeout(timer);
  }, [live, turns]);
  useEffect(() => {
    const runId = active?.id || latest?.id;
    if (!runId) return;
    let cancelled = false;
    chatControls(chatId).then(
      (rows) => {
        if (!cancelled) setControls(rows);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [chatId, active?.id, latest?.id, reads, refreshKey]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [
    turns?.length,
    latest?.response,
    latest?.runtime.conversation_messages?.length,
    notes.length,
    controls.length,
  ]);

  const ask = async (message: string, command?: "compact") => {
    if (!message || !canSend || stopRequested || (live && !canSteer)) return;
    setSending(true);
    try {
      if (active && !command)
        await controlChat(chatId, active.id, delivery, message);
      else
        await askChat(chatId, message, {
          ...(modelId ? { model_config_id: modelId } : {}),
          ...(command ? { command } : {}),
        });
      saveDraft({ text: "" });
      pinned.current = true;
      setReads((n) => n + 1);
      onChanged?.();
    } catch (error) {
      fail(error);
    } finally {
      setSending(false);
    }
  };
  const stop = async () => {
    if (!active) return;
    setStopping(true);
    try {
      await controlChat(chatId, active.id, "abort");
      setReads((n) => n + 1);
    } catch (error) {
      setStopping(false);
      fail(error);
    }
  };
  const name = async (words: string) => {
    if (!words.trim()) return;
    try {
      await renameChat(chatId, words.trim());
      onChanged?.();
      setRenaming(false);
    } catch (error) {
      fail(error);
    }
  };
  const lastContext = [...(turns ?? [])]
    .reverse()
    .find((turn) => turn.runtime.context)?.runtime.context;
  const answered = [...(turns ?? [])]
    .reverse()
    .find((turn) => turn.runtime.command !== "compact" && turn.response);
  const commands: SlashCommand[] = [
    ...(canSend && !live && session?.capabilities.compact
      ? [
          {
            name: "compact",
            description: t("commands.compact"),
            takesArgument: true,
            run: (words: string) => ask(`/compact ${words}`.trim(), "compact"),
          },
        ]
      : []),
    { name: "new", description: t("commands.new"), run: () => onNew() },
    ...(session?.capabilities.rename !== false
      ? [
          {
            name: "name",
            description: t("commands.name"),
            takesArgument: true,
            run: name,
          },
        ]
      : []),
    {
      name: "session",
      description: t("commands.session"),
      run: () =>
        void toast.show({
          message: t("commands.sessionInfo", {
            turns: (turns ?? []).filter((x) => x.runtime.command !== "compact")
              .length,
            model:
              models.find((m) => m.id === modelId)?.name ||
              models.find((m) => m.id === modelId)?.model ||
              "—",
            context: contextStatus(t, lastContext) || "—",
          }),
        }),
    },
    ...(canSend && !live && session?.capabilities.clone
      ? [
          {
            name: "clone",
            description: t("commands.clone"),
            run: async () => {
              try {
                const copy = await cloneChat(chatId);
                go(`projects/${workspace.id}/chats/${copy.id}`);
                onChanged?.();
              } catch (error) {
                fail(error);
              }
            },
          },
        ]
      : []),
    copyCommand(t, () => answered?.response ?? ""),
    ...(canSend && !live
      ? modelCommands(t, models, modelId, (id) => saveDraft({ model: id }))
      : []),
  ];
  const ours = notes.filter((note) => note.workspace_id === workspace.id);
  const pending = ours.filter((note) => note.pending === true);
  const history = ours.filter((note) => note.pending !== true);
  const consumed = new Set(
    (turns || [])
      .flatMap((turn) => turn.runtime.conversation_messages || [])
      .map((message) => message.control_id)
      .filter(Boolean),
  );
  const notice = (note: ResearchNote) => {
    const research = researches.find((r) => r.id === note.project_id);
    return research ? (
      <ResearchNotice
        key={`note-${note.id}`}
        note={note}
        question={research.question}
        go={go}
      />
    ) : null;
  };
  return (
    <div
      className={styles.chat}
      data-testid={main ? "project-main-chat" : "project-history-chat"}
    >
      <header className={styles.chatBar}>
        <div className={styles.chatHeading}>
          <h2>{chatTitle}</h2>
          <span>
            {t(main ? "projects.lead" : "projects.kind.chat")}
            {live &&
              ` · ${t(stopping || active?.runtime.phase === "stopping" ? "projects.sessions.stopping" : "projects.sessions.running")}`}
            {session?.archived_at && ` · ${t("projects.sessions.archived")}`}
          </span>
          {session?.source_session_id && (
            <a
              className={styles.sourceLink}
              href={`#projects/${workspace.id}/chats/${session.source_session_id}`}
              onClick={followLink(
                go,
                `projects/${workspace.id}/chats/${session.source_session_id}`,
              )}
            >
              {t("projects.sessions.source")}
            </a>
          )}
        </div>
        {session?.capabilities.rename && (
          <IconButton
            icon={Pencil}
            label={t("projects.sessions.rename")}
            size="sm"
            onClick={() => {
              setTitle(chatTitle);
              setRenaming(true);
            }}
          />
        )}
      </header>
      <div className={talk.scrollArea}>
        <div
          className={talk.scroll}
          ref={scroller}
          onScroll={(event) => {
            const el = event.currentTarget;
            pinned.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 72;
          }}
        >
          <div className={talk.thread}>
            {pending.length > 0 && (
              <section
                className={styles.pendingNotes}
                aria-label={t("projects.notes.pending")}
              >
                <h3>{t("projects.notes.pending")}</h3>
                {pending.map(notice)}
              </section>
            )}
            {loadError && (
              <p className={styles.sessionError}>
                {loadError}
                <Button size="sm" variant="ghost" onClick={read}>
                  {t("common.retry")}
                </Button>
              </p>
            )}
            {turns === null && !loadError && <Spinner />}
            {history.length > 0 && (
              <details
                className={styles.noteHistory}
                data-testid="project-note-history"
              >
                <summary>
                  {t("projects.notes.historyCount", { n: history.length })}
                </summary>
                <div>{history.map(notice)}</div>
              </details>
            )}
            {turns?.map((turn) => {
              return turn.runtime.command === "compact" ? (
                <p key={turn.id} className={talk.systemLine}>
                  {isLive(turn)
                    ? t("commands.compacting")
                    : turn.status !== "completed"
                      ? t("commands.compactFailed", { error: turn.error })
                      : turn.runtime.compaction?.error ||
                        t("commands.compacted")}
                </p>
              ) : (
                <div key={turn.id} className={styles.chatTurn}>
                  <div className={talk.mine}>{turn.prompt}</div>
                  <RunMessages turn={turn} main={main} />
                </div>
              );
            })}
            {controls
              .filter(
                (control) =>
                  control.kind !== "abort" && !consumed.has(control.id),
              )
              .map((control) => (
                <div key={control.id} className={styles.controlMessage}>
                  <div className={talk.mine}>{control.text}</div>
                  <span>
                    {control.status === "rejected"
                      ? control.error || t("projects.sessions.rejected")
                      : t(
                          control.status === "applied"
                            ? "projects.sessions.applied"
                            : control.kind === "follow_up"
                              ? "projects.sessions.queued"
                              : "projects.sessions.appended",
                        )}
                  </span>
                  {control.status === "rejected" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        saveDraft({
                          text: draft.text
                            ? `${draft.text}\n${control.text}`
                            : control.text,
                        })
                      }
                    >
                      {t("projects.sessions.recoverDraft")}
                    </Button>
                  )}
                </div>
              ))}
          </div>
        </div>
        <JumpToLatest scroller={scroller} streaming={live} />
      </div>
      <div className={talk.dock}>
        <Composer
          value={draft.text}
          onChange={(text) => saveDraft({ text })}
          busy={sending || stopRequested || (live && !canSteer)}
          disabled={!canSend}
          label={t(main ? "projects.lead" : "projects.chats.more")}
          placeholder={t(main ? "projects.lead" : "projects.newChat")}
          sendLabel={t("research.home.send")}
          commands={commands}
          status={contextStatus(t, lastContext)}
          tools={
            <>
              {models.length > 0 && !live && canSend && (
                <ModelPicker
                  models={models}
                  value={modelId}
                  onChange={(model) => saveDraft({ model })}
                  label={t("commands.model")}
                />
              )}
              {active && canSteer && (
                <Menu
                  label={t("projects.sessions.delivery")}
                  items={(["steer", "follow_up"] as const).map((kind) => ({
                    id: kind,
                    label: t(
                      kind === "steer"
                        ? "projects.sessions.append"
                        : "projects.sessions.queue",
                    ),
                    onSelect: () => setDelivery(kind),
                  }))}
                  trigger={(props) => (
                    <button
                      type="button"
                      className={talk.chip}
                      disabled={stopRequested}
                      {...props}
                    >
                      {t(
                        delivery === "steer"
                          ? "projects.sessions.append"
                          : "projects.sessions.queue",
                      )}
                    </button>
                  )}
                />
              )}
              {active && (
                <IconButton
                  icon={Square}
                  label={t(
                    stopping || active.runtime.phase === "stopping"
                      ? "projects.sessions.stopping"
                      : "projects.sessions.stop",
                  )}
                  size="sm"
                  disabled={stopping || active.runtime.phase === "stopping"}
                  onClick={stop}
                />
              )}
            </>
          }
          onSend={() => ask(draft.text.trim())}
        />
      </div>
      <Dialog
        open={renaming}
        onClose={() => setRenaming(false)}
        title={t("projects.sessions.rename")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={!title.trim()}
              onClick={() => name(title)}
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

function RunMessages({ turn, main }: { turn: ChatTurn; main: boolean }) {
  const { t } = useI18n();
  const role = main ? "lead" : "chat";
  const title = t(main ? "projects.lead" : "projects.chats.assistant");
  const messages = turn.runtime.conversation_messages || [];
  if (!messages.length)
    return (
      <RunTurn
        run={{ ...turn, role }}
        role={role}
        title={title}
        final={turn.response}
      />
    );
  const lastAssistant = messages
    .map((message) => message.role)
    .lastIndexOf("assistant");
  const writing =
    !!turn.response && turn.response !== messages[lastAssistant]?.text;
  return (
    <>
      {messages.map((message, index) =>
        message.role === "user" ? (
          <div key={message.id} className={talk.mine}>
            {message.text}
          </div>
        ) : (
          <RunTurn
            key={message.id}
            run={{
              ...turn,
              role,
              status:
                index === lastAssistant && !writing && !isLive(turn)
                  ? turn.status
                  : "completed",
              response: message.text,
              steps: index === lastAssistant && !writing ? turn.steps : [],
            }}
            role={role}
            title={title}
            final={message.text}
          />
        ),
      )}
      {(writing || (isLive(turn) && lastAssistant < 0)) && (
        <RunTurn
          run={{ ...turn, role }}
          role={role}
          title={title}
          final={turn.response}
        />
      )}
    </>
  );
}

function ResearchNotice({
  note,
  question,
  go,
}: {
  note: ResearchNote;
  question: string;
  go(hash: string): void;
}) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const long = note.text.length > 240;
  const hash = `research/${note.project_id}`;
  const when = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(note.created_at));
  return (
    <article
      className={styles.notice}
      data-testid="research-notice"
      data-pending={note.pending || undefined}
    >
      <a
        className={styles.noticeLink}
        href={`#${hash}`}
        onClick={followLink(go, hash)}
      >
        <span className={styles.noticeHead}>
          <span
            className={styles.badge}
            data-column={
              note.kind === "error"
                ? "dropped"
                : note.pending
                  ? "review"
                  : "done"
            }
          >
            {t(
              note.pending
                ? `projects.notes.${note.kind}`
                : `projects.notes.history.${note.kind}`,
            )}
          </span>
          <span className={styles.noticeState}>
            {t(
              note.pending
                ? "projects.notes.pending"
                : "projects.notes.history",
            )}
          </span>
          <time dateTime={note.created_at}>{when}</time>
        </span>
        <span className={styles.noticeQuestion}>{question}</span>
      </a>
      <p
        className={styles.noticeText}
        data-clamped={(long && !expanded) || undefined}
      >
        {note.text}
      </p>
      {long && (
        <button
          type="button"
          className={styles.noticeMore}
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {t(expanded ? "projects.notes.less" : "projects.notes.more")}
        </button>
      )}
    </article>
  );
}
