import { ArrowLeft, Pause, Play, Square } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  IconButton,
  Spinner,
  toast,
} from "../../ui";
import { DataFiles } from "./DataFiles";
import { Decisions } from "./Decisions";
import { MetricsStrip } from "./MetricsStrip";
import {
  getProject,
  listDecisions,
  projectMetrics,
  jobLog,
  pauseProject,
  resumeProject,
  stopProject,
  type Decision,
  type ProjectMetrics,
  type LogLines,
  type ProjectDetail,
} from "./research-api";
import { statusKey } from "./ResearchListScreen";
import { ResearchMap } from "./ResearchMap";
import { SprintTimeline } from "./SprintTimeline";
import styles from "./Research.module.css";

/** How often the page is read again: often while the agent works, seldom otherwise. */
const ACTIVE_POLL = 3000;
const IDLE_POLL = 15000;

export interface ResearchProjectScreenProps {
  id: string;
  go(hash: string): void;
}

/**
 * One research project: its question, how much of its budget is gone, the
 * research map, and the sprints that built it; pause, resume or stop it.
 */
export function ResearchProjectScreen({ id, go }: ResearchProjectScreenProps) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [metrics, setMetrics] = useState<ProjectMetrics | null>(null);
  const [failed, setFailed] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ jobId: string; lines: LogLines } | null>(
    null,
  );
  const [reads, setReads] = useState(0);
  // Counts the timer's rounds; a round in a hidden tab only waits for the next.
  const [rounds, setRounds] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getProject(id, controller.signal).then(
      (value) => {
        setDetail(value);
        setFailed("");
        projectMetrics(id).then(setMetrics, () => setMetrics(null));
        if (value.project.status === "waiting")
          listDecisions(id).then(setDecisions, () => setDecisions([]));
        else setDecisions([]);
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setFailed(error instanceof Error ? error.message : String(error));
      },
    );
    return () => controller.abort();
  }, [id, reads]);

  // Read again on a timer, faster while the agent is at work; a hidden tab waits.
  useEffect(() => {
    const working = detail?.project.status === "active";
    const timer = window.setTimeout(
      () =>
        document.hidden ? setRounds((n) => n + 1) : setReads((n) => n + 1),
      working ? ACTIVE_POLL : IDLE_POLL,
    );
    return () => window.clearTimeout(timer);
  }, [detail, reads, rounds]);

  const act = useCallback(
    async (action: typeof pauseProject) => {
      setBusy(true);
      try {
        await action(id);
        setReads((n) => n + 1);
      } catch (error) {
        toast.show({
          message: error instanceof Error ? error.message : String(error),
          tone: "error",
        });
      } finally {
        setBusy(false);
      }
    },
    [id],
  );

  const openLog = async (jobId: string) => {
    try {
      setLog({ jobId, lines: await jobLog(id, jobId) });
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    }
  };

  const back = (
    <IconButton
      icon={ArrowLeft}
      label={t("research.back")}
      size="sm"
      onClick={() => go("research")}
    />
  );

  if (!detail)
    return (
      <Card as="main" className={styles.root} aria-labelledby="research-title">
        <div className={styles.frame}>
          <CardHeader>
            {back}
            <h1 id="research-title" className={styles.heading}>
              {t("research.title")}
            </h1>
          </CardHeader>
          <div className={styles.body}>
            {failed ? (
              <p className={styles.error} role="alert">
                {t("research.loadFailed", { reason: failed })}
              </p>
            ) : (
              <p className={styles.loading} role="status" aria-busy="true">
                <Spinner size={14} />
                {t("common.loading")}
              </p>
            )}
          </div>
        </div>
      </Card>
    );

  const { project, nodes, sprints, jobs, docker } = detail;
  const focus = sprints.find((sprint) => sprint.status === "running");
  const meters: [string, number, number][] = [
    [
      t("research.meter.sprints"),
      project.spent.sprints,
      project.budget.max_sprints,
    ],
    [
      t("research.meter.tokens"),
      project.spent.tokens,
      project.budget.max_tokens,
    ],
    [
      t("research.meter.jobs"),
      project.spent.job_seconds,
      project.budget.max_job_seconds,
    ],
  ];

  return (
    <Card as="main" className={styles.root} aria-labelledby="research-title">
      <div className={styles.frame}>
        <CardHeader>
          {back}
          <h1 id="research-title" className={styles.heading}>
            {project.question}
          </h1>
          <span className={styles.state} data-status={project.status}>
            {t(statusKey(project))}
          </span>
          <span className={styles.spacer} />
          {project.status === "active" && (
            <Button
              size="sm"
              icon={Pause}
              loading={busy}
              onClick={() => act(pauseProject)}
            >
              {t("research.pause")}
            </Button>
          )}
          {(project.status === "paused" || project.status === "waiting") && (
            <Button
              size="sm"
              icon={Play}
              loading={busy}
              onClick={() => act(resumeProject)}
            >
              {t("research.resume")}
            </Button>
          )}
          {project.status !== "finished" && (
            <Button
              size="sm"
              variant="ghost"
              icon={Square}
              disabled={busy}
              onClick={() => act(stopProject)}
            >
              {t("research.stop")}
            </Button>
          )}
        </CardHeader>
        <div className={styles.projectBody}>
          <div className={styles.meters}>
            {meters.map(([label, used, max]) => (
              <div key={label} className={styles.meter}>
                <span className={styles.meterLabel}>
                  {label} {used.toLocaleString()} / {max.toLocaleString()}
                </span>
                <span className={styles.meterBar}>
                  <span
                    style={{
                      width: `${Math.min(100, (used / Math.max(max, 1)) * 100)}%`,
                    }}
                  />
                </span>
              </div>
            ))}
          </div>
          {!docker.available && (
            <p className={styles.notice} role="status">
              {t("research.noDocker", { reason: docker.reason })}
            </p>
          )}
          {metrics && <MetricsStrip metrics={metrics} />}
          <DataFiles projectId={id} />
          <Decisions
            projectId={id}
            decisions={decisions}
            nodes={nodes}
            onDecided={() => setReads((n) => n + 1)}
          />
          <div className={styles.columns}>
            <section className={styles.column} aria-labelledby="research-map">
              <h2 id="research-map" className={styles.sectionTitle}>
                {t("research.map")}
              </h2>
              <ResearchMap
                nodes={nodes}
                jobs={jobs}
                focusId={focus?.focus_node_id ?? null}
                onLog={(jobId) => void openLog(jobId)}
              />
            </section>
            <section
              className={styles.column}
              aria-labelledby="research-sprints"
            >
              <h2 id="research-sprints" className={styles.sectionTitle}>
                {t("research.sprints")}
              </h2>
              <SprintTimeline sprints={sprints} nodes={nodes} />
            </section>
          </div>
        </div>
      </div>
      <Dialog
        open={log !== null}
        onClose={() => setLog(null)}
        title={t("research.log")}
        description={
          log
            ? jobs.find((job) => job.id === log.jobId)?.command.slice(0, 200)
            : undefined
        }
      >
        <pre className={styles.log}>
          {log?.lines.lines.map((line) => `${line.n}  ${line.text}`).join("\n")}
        </pre>
      </Dialog>
    </Card>
  );
}
