import {
  ArrowLeft,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Square,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/i18n";
import { Dialog, IconButton, Menu, Spinner, toast } from "../../ui";
import {
  approvePlan,
  decide,
  getProject,
  jobLog,
  listEvents,
  listRuns,
  moveCompute,
  pauseProject,
  readResearchSettings,
  resumeProject,
  sendMessage,
  stopProject,
  type Compute,
  type LogLines,
  type ProjectDetail,
  type ResearchEvent,
  type Stage,
} from "./research-api";
import type { ResearchRun } from "./process/model";
import { LiveCard } from "./process/Process";
import { Composer } from "./talk/Composer";
import { RecordPanel, type RecordTab } from "./talk/RecordPanel";
import { buildThread, working } from "./talk/thread";
import { ThreadView, type ThreadActions } from "./talk/ThreadView";
import styles from "./talk/Talk.module.css";

const ACTIVE_POLL = 2500;
const IDLE_POLL = 12000;
const STEPS: Stage[] = [
  "scoping",
  "experiments",
  "conclusion",
  "retrospective",
];
const NARROW = "(max-width: 1100px)";

/**
 * One research project as a conversation with the advisor: the plan is talked
 * through, then the work and the decisions it needs come down the same thread.
 * The record (plan, runs, environment, answer) stays beside it.
 */
export function ResearchProject({
  id,
  go,
}: {
  id: string;
  go(hash: string): void;
}) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [events, setEvents] = useState<ResearchEvent[]>([]);
  const [computes, setComputes] = useState<Compute[]>([]);
  const [failed, setFailed] = useState("");
  const [reads, setReads] = useState(0);
  const [rounds, setRounds] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState("");
  const [record, setRecord] = useState(
    () => !window.matchMedia?.(NARROW).matches,
  );
  const [tab, setTab] = useState<RecordTab>("plan");
  const [run, setRun] = useState("");
  const [log, setLog] = useState<{ jobId: string; lines: LogLines } | null>(
    null,
  );
  const [runs, setRuns] = useState<ResearchRun[]>([]);
  const runsBySprint = useMemo(
    () =>
      new Map(runs.filter((r) => r.sprint_id).map((r) => [r.sprint_id!, r])),
    [runs],
  );
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

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
          )
        : [],
    [events, detail],
  );

  // Follow the conversation down, unless the reader scrolled up to look back.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [items.length, pending, detail?.sprints]);

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
    setText("");
    pinned.current = true;
    try {
      await sendMessage(id, words);
      refresh();
    } catch (error) {
      setText(words);
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

  if (!detail)
    return (
      <div className={styles.page}>
        <div className={styles.head}>
          <IconButton
            icon={ArrowLeft}
            label={t("research.back")}
            size="sm"
            onClick={() => go("research")}
          />
        </div>
        <div className={styles.thread}>
          {failed ? <p className={styles.empty}>{failed}</p> : <Spinner />}
        </div>
      </div>
    );

  const p = detail.project;
  const busyNow = working(detail.sprints);
  const liveRun = busyNow ? runsBySprint.get(busyNow.id) : undefined;
  const waitingData = detail.datasets.some((d) => d.status === "pending");
  const finished = p.status === "finished" && p.stage === "done";
  const stageIndex = STEPS.indexOf(
    p.stage === "done" ? "retrospective" : p.stage,
  );
  const hours = (p.spent.job_seconds ?? 0) / 3600;
  const maxHours = (p.budget.max_job_seconds ?? 0) / 3600;
  const ratio =
    p.stage === "scoping"
      ? 0
      : Math.min(
          1,
          Math.max(
            p.spent.sprints / Math.max(p.budget.max_sprints, 1),
            hours / Math.max(maxHours, 0.01),
          ),
        );

  const placeholder: MessageKey =
    p.stage === "scoping"
      ? "research.composer.scoping"
      : p.status === "waiting"
        ? "research.composer.waiting"
        : "research.composer.experiments";

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <IconButton
          icon={ArrowLeft}
          label={t("research.back")}
          size="sm"
          onClick={() => go("research")}
        />
        <h1 className={styles.headTitle} title={p.question}>
          {p.question}
        </h1>
        <ol className={styles.stages} aria-label={t("research.stages")}>
          {STEPS.map((step, i) => (
            <li key={step} style={{ display: "contents" }}>
              {i > 0 && <span className={styles.stageLine} aria-hidden />}
              <span
                className={styles.stageStep}
                data-state={
                  finished || i < stageIndex
                    ? "done"
                    : i === stageIndex
                      ? "now"
                      : "ahead"
                }
                aria-current={
                  i === stageIndex && !finished ? "step" : undefined
                }
              >
                {t(`research.stage.${step}` as MessageKey)}
              </span>
            </li>
          ))}
        </ol>
        {p.stage !== "scoping" && (
          <div className={styles.budget} title={t("research.budget.title")}>
            <span>
              {t("research.budget.line", {
                sprints: p.spent.sprints,
                max: p.budget.max_sprints,
                hours: hours.toFixed(1),
                maxHours: maxHours.toFixed(1),
              })}
            </span>
            <span className={styles.meter}>
              <span style={{ width: `${Math.round(ratio * 100)}%` }} />
            </span>
          </div>
        )}
        <div className={styles.headTools}>
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
            onClick={() => setRecord(!record)}
          />
        </div>
      </header>
      <div className={styles.body}>
        <div className={styles.talk}>
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
                </p>
              )}
              {p.status === "paused" && (
                <p className={styles.systemLine}>
                  {t("research.thread.paused")}
                </p>
              )}
            </div>
          </div>
          <div className={styles.dock}>
            {liveRun && busyNow && (
              <LiveCard
                run={liveRun}
                role={busyNow.role}
                name={t(
                  `research.role.${busyNow.role === "scoping" ? "advisor" : busyNow.role}` as MessageKey,
                )}
              />
            )}
            <Composer
              value={text}
              onChange={setText}
              onSend={say}
              busy={!!pending}
              disabled={finished}
              label={t("research.composer.label")}
              placeholder={t(
                finished ? "research.composer.finished" : placeholder,
              )}
              sendLabel={t("research.home.send")}
            />
          </div>
        </div>
        {record && (
          <RecordPanel
            detail={detail}
            events={events}
            computes={computes}
            tab={tab}
            onTab={setTab}
            run={run}
            onRun={setRun}
            actions={actions}
          />
        )}
      </div>
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
