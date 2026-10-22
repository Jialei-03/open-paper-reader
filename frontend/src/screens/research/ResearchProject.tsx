import {
  ArrowLeft,
  Folder,
  Monitor,
  Server,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Square,
} from "lucide-react";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { followLink } from "../../reader/route";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/i18n";
import {
  Button,
  Dialog,
  IconButton,
  Menu,
  Spinner,
  TextArea,
  TextField,
  toast,
} from "../../ui";
import {
  approvePlan,
  controlChat,
  decide,
  getProject,
  jobLog,
  listEvents,
  listRuns,
  restateQuestion,
  moveCompute,
  moveModel,
  pauseProject,
  reportUrl,
  readResearchSettings,
  resumeProject,
  sendMessage,
  stopProject,
  type Compute,
  type LogLines,
  type ProjectDetail,
  type ResearchEvent,
} from "./research-api";
import { isLive, type ResearchRun } from "./process/model";
import { LiveCard } from "./process/Process";
import { JumpToLatest } from "../../reader/JumpToLatest";
import { OPEN_FILES_EVENT } from "./files/files-api";
import type { SlashCommand } from "../../lib/slash";
import { readModels, type ModelRow } from "../setup/model-api";
import { copyCommand, modelCommands } from "../../lib/composer-commands";
import { Composer } from "./talk/Composer";
import { ModelPicker } from "./talk/Pickers";
import { RecordPanel, type RecordTab } from "./talk/RecordPanel";
import { buildThread, working } from "./talk/thread";
import { ThreadView, type ThreadActions } from "./talk/ThreadView";
import { ResearchChanges, ResearchOrigin } from "./ResearchChanges";
import { AppActions } from "../../app/AppSidebar";
import { ResearchOrganization } from "./ResearchLibrary";
import { refreshResearchNavigation } from "./navigation-api";
import { useResearchNavigation } from "./ResearchNavigation";
import { workspaceMachine } from "./workspace-machine";
import styles from "./talk/Talk.module.css";

const ACTIVE_POLL = 2500;
const IDLE_POLL = 12000;

/**
 * One research project as a conversation with the advisor: the plan is talked
 * through, then the work and the decisions it needs come down the same thread.
 * The record (plan, runs, environment, answer) stays beside it.
 */
export function ResearchProject({
  id,
  go,
  backHash,
}: {
  id: string;
  go(hash: string): void;
  backHash?: string;
}) {
  const { t, locale } = useI18n();
  const { data: navigation, connections } = useResearchNavigation();
  const { owner } = useContext(AppActions);
  const draftKey = `ora-research-draft:${owner || "local"}:${id}`;
  const [models, setModels] = useState<ModelRow[]>([]);
  useEffect(() => {
    readModels().then(
      (s) => setModels(s.models),
      () => setModels([]),
    );
  }, []);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [events, setEvents] = useState<ResearchEvent[]>([]);
  const [computes, setComputes] = useState<Compute[]>([]);
  const [failed, setFailed] = useState("");
  const [reads, setReads] = useState(0);
  const [rounds, setRounds] = useState(0);
  const [text, setText] = useState("");
  useEffect(() => {
    try {
      setText(localStorage.getItem(draftKey) || "");
    } catch {
      setText("");
    }
  }, [draftKey]);
  const changeText = (value: string) => {
    setText(value);
    try {
      value
        ? localStorage.setItem(draftKey, value)
        : localStorage.removeItem(draftKey);
    } catch {
      /* Private browsing can disable storage. */
    }
  };
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState("");
  const [record, setRecord] = useState(false);
  const [tab, setTab] = useState<RecordTab | null>(null);
  const [run, setRun] = useState("");
  const [log, setLog] = useState<{ jobId: string; lines: LogLines } | null>(
    null,
  );
  const [runs, setRuns] = useState<ResearchRun[]>([]);
  const [editing, setEditing] = useState<{
    question: string;
    note: string;
  } | null>(null);
  const runsBySprint = useMemo(
    () =>
      new Map(runs.filter((r) => r.sprint_id).map((r) => [r.sprint_id!, r])),
    [runs],
  );
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    setRecord(false);
    setTab(null);
    setRun("");
  }, [id]);

  // The /files command, or anything else, asks for the files panel.
  useEffect(() => {
    const show = () => {
      setRecord(true);
      setTab("files");
    };
    window.addEventListener(OPEN_FILES_EVENT, show);
    return () => window.removeEventListener(OPEN_FILES_EVENT, show);
  }, []);

  useEffect(() => {
    readResearchSettings().then(
      (s) => setComputes(s.computes),
      () => undefined,
    );
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getProject(id, controller.signal),
      listEvents(id),
      listRuns(id),
    ]).then(
      ([value, rows, recent]) => {
        setDetail(value);
        setEvents(rows);
        setRuns(recent);
        setFailed("");
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setFailed(error instanceof Error ? error.message : String(error));
      },
    );
    return () => controller.abort();
  }, [id, reads]);

  const active =
    !!detail &&
    (detail.project.status === "active" || !!working(detail.sprints));
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        document.hidden ? setRounds((n) => n + 1) : setReads((n) => n + 1),
      active ? ACTIVE_POLL : IDLE_POLL,
    );
    return () => window.clearTimeout(timer);
  }, [active, reads, rounds]);

  const items = useMemo(
    () =>
      detail
        ? buildThread(
            events,
            detail.sprints,
            detail.jobs,
            detail.nodes,
            detail.project.stage,
            detail.project.plan,
          )
        : [],
    [events, detail],
  );

  // Follow the conversation down, unless the reader scrolled up to look back.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [items.length, pending, detail?.sprints, runs]);

  const fail = (error: unknown) =>
    toast.show({
      message: error instanceof Error ? error.message : String(error),
      tone: "error",
    });

  const refresh = () => setReads((n) => n + 1);

  const say = async () => {
    const words = text.trim();
    if (!words) return;
    setPending(words);
    changeText("");
    pinned.current = true;
    try {
      await sendMessage(id, words);
      refreshResearchNavigation();
      refresh();
    } catch (error) {
      changeText(words);
      fail(error);
    } finally {
      setPending("");
    }
  };

  const actions: ThreadActions = {
    busy,
    approvePlan: async (version) => {
      setBusy(true);
      try {
        await approvePlan(id, version);
        refresh();
      } catch (error) {
        fail(error);
      } finally {
        setBusy(false);
      }
    },
    decide: async (requestId, approve, note) => {
      setBusy(true);
      try {
        await decide(id, requestId, approve, note);
        refresh();
      } catch (error) {
        fail(error);
      } finally {
        setBusy(false);
      }
    },
    openLog: async (jobId) => {
      try {
        setLog({ jobId, lines: await jobLog(id, jobId) });
      } catch (error) {
        fail(error);
      }
    },
    moveCompute: async (computeId) => {
      try {
        await moveCompute(id, computeId);
        refresh();
      } catch (error) {
        fail(error);
      }
    },
    openRun: (jobId) => {
      setRun(jobId);
      setTab("runs");
      setRecord(true);
    },
  };

  const move = useCallback(
    async (action: typeof pauseProject) => {
      try {
        await action(id);
        refresh();
      } catch (error) {
        fail(error);
      }
    },
    [id],
  );
  const chooseModel = async (modelId: string) => {
    try {
      await moveModel(id, modelId);
      refresh();
    } catch (error) {
      fail(error);
    }
  };

  if (!detail)
    return (
      <div className={styles.page}>
        <div className={styles.head}>
          <IconButton
            icon={ArrowLeft}
            label={t("research.back")}
            size="sm"
            onClick={() => go(backHash || "new")}
          />
        </div>
        <div className={styles.thread}>
          {failed ? <p className={styles.empty}>{failed}</p> : <Spinner />}
        </div>
      </div>
    );

  const p = detail.project;
  const workspaceName =
    navigation.workspaces.find((workspace) => workspace.id === p.workspace_id)
      ?.name ||
    p.location?.path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ||
    t("workspace.workspaces");
  const machine = workspaceMachine(
    p.location,
    connections,
    t("workspace.local"),
    t("workspace.remote"),
  );
  const busyNow = working(detail.sprints);
  const candidateRun = busyNow ? runsBySprint.get(busyNow.id) : undefined;
  const liveRun =
    candidateRun && isLive(candidateRun) ? candidateRun : undefined;
  const waitingData = detail.datasets.some((d) => d.status === "pending");
  // How far the download has got, as the worker last wrote it down.
  const fetchNote =
    detail.datasets.find((d) => d.status === "pending" && d.note)?.note ?? "";
  const finished = p.status === "finished" && p.stage === "done";
  const recordTab =
    tab ?? (p.stage === "conclusion" || p.stage === "done" ? "answer" : "plan");
  // What "/" offers on a research: how it runs, its report, its model.
  const commands: SlashCommand[] = [
    ...(p.status === "paused"
      ? [
          {
            name: "resume",
            description: t("research.resume"),
            run: () => move(resumeProject),
          },
        ]
      : p.status === "active"
        ? [
            {
              name: "pause",
              description: t("research.pause"),
              run: () => move(pauseProject),
            },
          ]
        : []),
    ...(p.status !== "finished"
      ? [
          {
            name: "stop",
            description: t("research.stop"),
            run: () => move(stopProject),
          },
        ]
      : []),
    {
      name: "files",
      description: t("commands.files"),
      run: () => {
        setTab("files");
        setRecord(true);
      },
    },
    ...(p.status !== "finished"
      ? [
          {
            name: "question",
            description: t("commands.question"),
            takesArgument: true,
            run: (words: string) =>
              setEditing({ question: words || p.question, note: "" }),
          },
        ]
      : []),
    {
      name: "report",
      description: t("commands.report"),
      run: () => void window.open(reportUrl(id, locale === "zh" ? "zh" : "en")),
    },
    copyCommand(t, () => {
      const said = [...events]
        .reverse()
        .find((e) => e.actor === "advisor" && e.action === "message");
      return typeof said?.detail.text === "string" ? said.detail.text : "";
    }),
    // A finished research has no next round to change the model of.
    ...(finished
      ? []
      : modelCommands(t, models, p.model_config_id, chooseModel)),
  ];
  const hours = (p.spent.job_seconds ?? 0) / 3600;
  const maxHours = (p.budget.max_job_seconds ?? 0) / 3600;
  const pendingPlan = items.find(
    (item) =>
      item.kind === "plan" &&
      item.current &&
      !item.plan.approved_at &&
      !item.plan.inherited,
  );
  const pendingDecision = items.find(
    (item) => item.kind === "decision" && item.open,
  );
  const attention =
    !liveRun && p.status !== "finished"
      ? pendingPlan
        ? { kind: "plan" as const, id: pendingPlan.id }
        : pendingDecision
          ? { kind: "decision" as const, id: pendingDecision.id }
          : null
      : null;
  const viewAttention = () => {
    if (!attention) return;
    const card = document.getElementById(
      `research-${attention.kind}-${attention.id}`,
    );
    if (!card || !scroller.current?.contains(card)) return;
    // Keep the reader at the selected card when the next poll arrives.
    pinned.current = false;
    card.scrollIntoView({
      block: "start",
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
    card.focus({ preventScroll: true });
  };
  const status =
    p.status === "paused"
      ? "paused"
      : liveRun
        ? "running"
        : p.status === "finished"
          ? p.end_reason === "stopped"
            ? "stopped"
            : "finished"
          : p.status === "waiting" || pendingPlan
            ? "waiting"
            : detail.jobs.some((job) =>
                  ["queued", "running"].includes(job.status),
                ) || waitingData
              ? "running"
              : "ready";
  const statusTitle = [
    t(`research.stage.${p.stage}` as MessageKey),
    p.budget.max_sprints
      ? t("research.budget.line", {
          sprints: p.spent.sprints,
          max: p.budget.max_sprints,
          hours: hours.toFixed(1),
          maxHours: maxHours.toFixed(1),
        })
      : t("research.budget.rounds", { sprints: p.spent.sprints }),
  ].join(" · ");

  const placeholder: MessageKey =
    p.status === "finished"
      ? "research.composer.finished"
      : p.status === "paused"
        ? "research.composer.paused"
        : status === "waiting"
          ? "research.composer.waiting"
          : status === "running" && p.stage !== "scoping"
            ? "research.composer.experiments"
            : "research.composer.scoping";

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <IconButton
          icon={ArrowLeft}
          label={t("research.back")}
          size="sm"
          onClick={() =>
            go(
              backHash ||
                (detail?.project.workspace_id
                  ? `workspaces/${detail.project.workspace_id}`
                  : "new"),
            )
          }
        />
        <h1 className={styles.headTitle}>
          <span title={p.question}>{p.title || p.question}</span>
        </h1>
        <span
          className={styles.researchStatus}
          data-status={status}
          title={statusTitle}
          role="status"
        >
          {t(`research.status.${status}` as MessageKey)}
        </span>
        <div className={styles.headTools}>
          {p.status === "paused" && (
            <Button
              size="sm"
              variant="secondary"
              icon={Play}
              onClick={() => move(resumeProject)}
            >
              {t("research.resume")}
            </Button>
          )}
          {liveRun &&
            ["scoping", "discussion"].includes(busyNow?.role || "") && (
              <IconButton
                icon={Square}
                label={t("projects.sessions.stop")}
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await controlChat(p.session_id, liveRun.id, "abort");
                    refresh();
                  } catch (error) {
                    fail(error);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            )}
          <ResearchOrganization project={p} onChanged={refresh} />
          <div
            className={styles.headChanges}
            role="group"
            aria-label={t("research.changes.actions")}
          >
            <ResearchChanges
              project={p}
              go={go}
              onChanged={refresh}
              refreshKey={reads}
            />
          </div>
          <Menu
            label={t("research.actions")}
            items={[
              p.status === "paused"
                ? {
                    id: "resume",
                    label: t("research.resume"),
                    icon: Play,
                    onSelect: () => move(resumeProject),
                  }
                : {
                    id: "pause",
                    label: t("research.pause"),
                    icon: Pause,
                    onSelect: () => move(pauseProject),
                    disabled: p.status !== "active",
                  },
              {
                id: "stop",
                label: t("research.stop"),
                icon: Square,
                onSelect: () => move(stopProject),
                disabled: p.status === "finished",
              },
            ]}
            trigger={(props) => (
              <IconButton
                icon={MoreHorizontal}
                label={t("research.actions")}
                size="sm"
                {...props}
              />
            )}
          />
          <IconButton
            icon={record ? PanelRightClose : PanelRightOpen}
            label={t(record ? "research.record.hide" : "research.record.show")}
            size="sm"
            onClick={() => {
              setTab(recordTab);
              setRecord(!record);
            }}
          />
        </div>
      </header>
      <div className={styles.body}>
        <div className={styles.talk}>
          <div className={styles.scrollArea}>
            <div
              className={styles.scroll}
              ref={scroller}
              onScroll={(event) => {
                const el = event.currentTarget;
                pinned.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              }}
            >
              <div className={styles.thread}>
                <ResearchOrigin
                  detail={detail}
                  go={go}
                  onResume={() => move(resumeProject)}
                />
                <ThreadView
                  items={items}
                  project={p}
                  computes={computes}
                  actions={actions}
                  runs={runsBySprint}
                />
                {pending && <div className={styles.mine}>{pending}</div>}
                {waitingData && p.stage === "experiments" && (
                  <p className={styles.systemLine}>
                    {t("research.thread.fetching")}
                    {fetchNote && ` ${fetchNote}`}
                  </p>
                )}
                {p.status === "paused" && (
                  <p className={styles.systemLine}>
                    {t("research.thread.paused")}
                  </p>
                )}
              </div>
            </div>
            <JumpToLatest scroller={scroller} streaming={!!busyNow} />
          </div>
          <div className={styles.dock}>
            {attention && (
              <div className={styles.attention}>
                <span>
                  {t(
                    attention.kind === "plan"
                      ? "research.attention.plan"
                      : "research.attention.decision",
                  )}
                </span>
                <Button size="sm" variant="secondary" onClick={viewAttention}>
                  {t(
                    attention.kind === "plan"
                      ? "research.attention.viewPlan"
                      : "research.attention.viewDecision",
                  )}
                </Button>
              </div>
            )}
            {liveRun && busyNow && (
              <LiveCard
                run={liveRun}
                role={busyNow.role}
                name={t(
                  `research.role.${["scoping", "discussion"].includes(busyNow.role) ? "discussion" : busyNow.role}` as MessageKey,
                )}
              />
            )}
            {p.location && (
              <div className={styles.locationBar}>
                <a
                  href={`#workspaces/${p.workspace_id}`}
                  onClick={followLink(go, `workspaces/${p.workspace_id}`)}
                  title={p.location.path}
                >
                  <Folder size={14} aria-hidden />
                  <span>{workspaceName}</span>
                </a>
                <span className={styles.locationMachine} title={machine.title}>
                  {p.location.kind === "ssh" ? (
                    <Server size={14} aria-hidden />
                  ) : (
                    <Monitor size={14} aria-hidden />
                  )}
                  <span>{machine.label}</span>
                </span>
              </div>
            )}
            <Composer
              value={text}
              onChange={changeText}
              onSend={say}
              busy={!!pending}
              label={t("research.composer.label")}
              placeholder={t(placeholder)}
              sendLabel={t("research.home.send")}
              commands={commands}
              acceptInserts
              tools={
                models.length > 0 &&
                !finished && (
                  <ModelPicker
                    models={models}
                    value={p.model_config_id}
                    onChange={(modelId) => void chooseModel(modelId)}
                    label={t("commands.model")}
                  />
                )
              }
            />
          </div>
        </div>
        {record && (
          <RecordPanel
            detail={detail}
            events={events}
            computes={computes}
            tab={recordTab}
            onTab={setTab}
            run={run}
            onRun={setRun}
            actions={actions}
          />
        )}
      </div>
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={t("research.question.edit")}
        description={t("research.question.lead")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={!editing?.question.trim()}
              onClick={async () => {
                if (!editing) return;
                try {
                  await restateQuestion(
                    id,
                    editing.question.trim(),
                    editing.note.trim(),
                  );
                  setEditing(null);
                  refresh();
                } catch (error) {
                  fail(error);
                }
              }}
            >
              {t("research.question.save")}
            </Button>
          </>
        }
      >
        {editing && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <TextArea
              label={t("research.question.label")}
              rows={4}
              value={editing.question}
              onChange={(e) =>
                setEditing({ ...editing, question: e.target.value })
              }
            />
            <TextField
              label={t("research.question.note")}
              value={editing.note}
              placeholder={t("research.question.notePlaceholder")}
              onChange={(e) => setEditing({ ...editing, note: e.target.value })}
            />
          </div>
        )}
      </Dialog>
      <Dialog
        open={!!log}
        onClose={() => setLog(null)}
        title={t("research.run.logTitle")}
        size="lg"
      >
        {log && (
          <pre className={styles.logBox}>
            {log.lines.lines
              .map((line) => `${String(line.n).padStart(4)}  ${line.text}`)
              .join("\n")}
          </pre>
        )}
      </Dialog>
    </div>
  );
}
