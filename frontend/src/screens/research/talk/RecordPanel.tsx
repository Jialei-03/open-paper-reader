import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import type { MessageKey } from "../../../i18n/i18n";
import { Button, SegmentedControl } from "../../../ui";
import { buildConversation } from "../conversation";
import {
  jobSeries,
  reportUrl,
  type Compute,
  type ProjectDetail,
  type ResearchEvent,
  type ResearchJob,
  type SeriesPoint,
} from "../research-api";
import { ResearchScene } from "../scene/ResearchScene";
import { mainMetric, plainCommand } from "../process/model";
import { Prose, trackerLink, type ThreadActions } from "./ThreadView";
import { ComputePicker } from "./Pickers";
import styles from "./Talk.module.css";

export type RecordTab = "plan" | "runs" | "setup" | "answer" | "scene";
const TABS: RecordTab[] = ["plan", "runs", "setup", "answer", "scene"];

const TONE: Record<string, string> = {
  supported: "good",
  refuted: "bad",
  abandoned: "bad",
  active: "strong",
  parked: "warn",
};

/** What the project has on record, beside the conversation that made it. */
export function RecordPanel({
  detail,
  events,
  computes,
  tab,
  onTab,
  run,
  onRun,
  actions,
}: {
  detail: ProjectDetail;
  events: ResearchEvent[];
  computes: Compute[];
  tab: RecordTab;
  onTab(tab: RecordTab): void;
  run: string;
  onRun(id: string): void;
  actions: ThreadActions;
}) {
  const { t } = useI18n();
  return (
    <aside className={styles.record} aria-label={t("research.record.title")}>
      <div className={styles.recordHead}>
        <SegmentedControl
          kind="tabs"
          size="sm"
          label={t("research.record.title")}
          value={tab}
          onChange={onTab}
          options={TABS.map((value) => ({
            value,
            label: t(`research.record.${value}` as MessageKey),
            panelId: `record-${value}`,
          }))}
        />
      </div>
      <div
        className={styles.recordBody}
        id={`record-${tab}`}
        role="tabpanel"
        aria-labelledby={`record-${tab}-tab`}
      >
        {tab === "plan" && <PlanTab detail={detail} />}
        {tab === "runs" && (
          <RunsTab detail={detail} run={run} onRun={onRun} actions={actions} />
        )}
        {tab === "setup" && (
          <SetupTab
            detail={detail}
            computes={computes}
            onMove={actions.moveCompute}
          />
        )}
        {tab === "answer" && <AnswerTab detail={detail} />}
        {tab === "scene" && (
          <SceneTab detail={detail} events={events} actions={actions} />
        )}
      </div>
    </aside>
  );
}

function PlanTab({ detail }: { detail: ProjectDetail }) {
  const { t } = useI18n();
  const plan = detail.project.plan;
  const nodes = detail.nodes.filter((n) => n.parent_id !== null);
  return (
    <>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("research.record.question")}</h3>
        <p className={styles.prose}>{detail.project.question}</p>
        {"metric" in plan && plan.metric && (
          <dl className={styles.kv}>
            <dt>{t("research.plan.metric")}</dt>
            <Long text={plan.metric} />
            {plan.baseline && (
              <>
                <dt>{t("research.plan.baseline")}</dt>
                <Long text={plan.baseline} />
              </>
            )}
            {plan.goal && (
              <>
                <dt>{t("research.plan.goal")}</dt>
                <Long text={plan.goal} />
              </>
            )}
          </dl>
        )}
      </section>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("research.record.map")}</h3>
        {nodes.length === 0 ? (
          <p className={styles.empty}>
            {detail.project.stage === "scoping"
              ? t("research.record.mapScoping")
              : t("research.record.mapEmpty")}
          </p>
        ) : (
          <div>
            {nodes.map((n) => (
              <div key={n.id} className={styles.nodeRow}>
                <span>{n.title}</span>
                <span className={styles.tag} data-tone={TONE[n.status]}>
                  {t(`research.node.${n.status}` as MessageKey)}
                </span>
                {n.kill_if && (
                  <small>
                    {t("research.plan.killIf", { text: n.kill_if })}
                  </small>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function RunsTab({
  detail,
  run,
  onRun,
  actions,
}: {
  detail: ProjectDetail;
  run: string;
  onRun(id: string): void;
  actions: ThreadActions;
}) {
  const { t } = useI18n();
  const titles = new Map(detail.nodes.map((n) => [n.id, n.title]));
  const selected = detail.jobs.find((j) => j.id === run);
  if (detail.jobs.length === 0)
    return <p className={styles.empty}>{t("research.record.noRuns")}</p>;
  return (
    <>
      {selected && (
        <RunDetail
          projectId={detail.project.id}
          job={selected}
          actions={actions}
        />
      )}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>
          {t("research.record.runCount", { n: detail.jobs.length })}
        </h3>
        {detail.jobs.map((job) => (
          <button
            key={job.id}
            type="button"
            className={styles.runRow}
            data-selected={job.id === run || undefined}
            onClick={() => onRun(job.id)}
          >
            <span className={styles.runHead}>
              <span className={styles.status} data-status={job.status}>
                {t(`research.job.${job.status}` as MessageKey)}
              </span>
              <span className={styles.command}>
                {(typeof job.config?.tag === "string" && job.config.tag) ||
                  titles.get(job.node_id) ||
                  plainCommand(job.command)}
              </span>
              <MainNumber metrics={job.metrics ?? {}} />
            </span>
          </button>
        ))}
      </section>
    </>
  );
}

function RunDetail({
  projectId,
  job,
  actions,
}: {
  projectId: string;
  job: ResearchJob;
  actions: ThreadActions;
}) {
  const { t } = useI18n();
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [metric, setMetric] = useState("");
  useEffect(() => {
    if (!job.points) {
      setSeries([]);
      return;
    }
    jobSeries(projectId, job.id).then(setSeries, () => setSeries([]));
  }, [projectId, job.id, job.points]);
  const keys = useMemo(() => {
    const out = new Set<string>();
    for (const row of series)
      for (const [k, v] of Object.entries(row))
        if (k !== "step" && k !== "t" && typeof v === "number") out.add(k);
    return [...out];
  }, [series]);
  const shown = keys.includes(metric) ? metric : (keys[0] ?? "");
  const tracker = trackerLink(job.tracker_url ?? "");
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("research.record.run")}</h3>
      <code className={styles.mono} title={job.command}>
        {plainCommand(job.command)}
      </code>
      {shown && (
        <div className={styles.chart}>
          <div className={styles.tags}>
            {keys.map((k) => (
              <button
                key={k}
                type="button"
                className={styles.chip}
                aria-pressed={k === shown}
                onClick={() => setMetric(k)}
              >
                {k}
              </button>
            ))}
          </div>
          <Curve
            points={series
              .map((r) => r[shown])
              .filter((v): v is number => typeof v === "number")}
          />
        </div>
      )}
      {Object.keys(job.config ?? {}).length > 0 && (
        <dl className={styles.kv}>
          {Object.entries(job.config).map(([k, v]) => (
            <Fragment key={k} k={k} v={String(v)} />
          ))}
        </dl>
      )}
      <div className={styles.runFoot}>
        <button
          type="button"
          className={styles.link}
          onClick={() => actions.openLog(job.id)}
        >
          {t("research.run.log")}
        </button>
        {tracker ? (
          <a
            className={styles.link}
            href={tracker}
            target="_blank"
            rel="noreferrer"
          >
            {t("research.run.tracker")}
          </a>
        ) : job.tracker_url.startsWith("local:") ? (
          <span title={job.tracker_url.slice(6)}>
            {t("research.run.trackerLocal")}
          </span>
        ) : job.tracker_url.startsWith("error") ? (
          <span title={job.tracker_url}>{t("research.run.trackerError")}</span>
        ) : null}
      </div>
    </section>
  );
}

function Fragment({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd className={styles.mono}>{v}</dd>
    </>
  );
}

/** A metric over its steps: one line, its lowest and highest values marked. */
function Curve({ points }: { points: number[] }) {
  if (points.length < 2)
    return <p className={styles.empty}>{points.length ? points[0] : ""}</p>;
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = hi - lo || 1;
  const xy = points.map(
    (v, i) =>
      [(i / (points.length - 1)) * 100, 100 - ((v - lo) / span) * 100] as const,
  );
  const line = xy.map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${lo} – ${hi}`}
      >
        <polygon
          className={styles.chartArea}
          points={`0,100 ${line} 100,100`}
        />
        <polyline className={styles.chartLine} points={line} />
      </svg>
      <div className={styles.chartAxis}>
        <span>{lo.toPrecision(4)}</span>
        <span>{points[points.length - 1].toPrecision(4)}</span>
        <span>{hi.toPrecision(4)}</span>
      </div>
    </>
  );
}

function SetupTab({
  detail,
  computes,
  onMove,
}: {
  detail: ProjectDetail;
  computes: Compute[];
  onMove(id: string): void;
}) {
  const { t } = useI18n();
  const compute = computes.find((c) => c.id === detail.project.compute_id);
  const env = detail.project.environment?.[detail.project.compute_id];
  return (
    <>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("research.setup.compute")}</h3>
        {computes.length > 1 && detail.project.status !== "finished" && (
          <div className={styles.tags}>
            <ComputePicker
              computes={computes}
              value={detail.project.compute_id}
              onChange={(id) => id !== detail.project.compute_id && onMove(id)}
              label={t("research.setup.move")}
            />
          </div>
        )}
        <dl className={styles.kv}>
          <dt>{t("research.setup.where")}</dt>
          <dd>
            {compute?.name ?? detail.project.compute_id}
            {compute?.kind === "ssh" ? ` (${compute.host})` : ""}
          </dd>
          {env ? (
            <>
              <dt>Python</dt>
              <dd>{env.python}</dd>
              <dt>{t("research.setup.machine")}</dt>
              <dd>
                {[
                  env.platform,
                  env.cpus && `${env.cpus} CPU`,
                  env.memory_gb && `${env.memory_gb} GB`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </dd>
              <dt>GPU</dt>
              <dd>
                {env.gpus?.length
                  ? env.gpus.join(", ")
                  : env.mps
                    ? t("research.setup.appleGpu")
                    : t("research.setup.noGpu")}
              </dd>
              {Object.entries(env.packages ?? {}).map(([k, v]) => (
                <Fragment key={k} k={k} v={v} />
              ))}
            </>
          ) : (
            <>
              <dt />
              <dd className={styles.empty}>{t("research.setup.notProbed")}</dd>
            </>
          )}
        </dl>
        {!detail.docker.available && compute?.kind === "docker" && (
          <p className={styles.empty}>{detail.docker.reason}</p>
        )}
      </section>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("research.setup.data")}</h3>
        {detail.datasets.length === 0 ? (
          <p className={styles.empty}>{t("research.setup.noData")}</p>
        ) : (
          detail.datasets.map((d) => (
            <div key={d.id} className={styles.nodeRow}>
              <span>
                {d.name} <span className={styles.mono}>{d.path}</span>
              </span>
              <span
                className={styles.tag}
                data-tone={
                  d.status === "ready"
                    ? "good"
                    : d.status === "failed"
                      ? "bad"
                      : "warn"
                }
              >
                {t(`research.data.${d.status}` as MessageKey)}
              </span>
              <small>
                {d.status === "failed"
                  ? d.note
                  : d.files
                      .map(
                        (f) =>
                          `${f.name} · ${(f.bytes / 1e6).toFixed(1)} MB · sha256 ${f.sha256.slice(0, 10)}`,
                      )
                      .join("\n")}
              </small>
            </div>
          ))
        )}
      </section>
    </>
  );
}

function AnswerTab({ detail }: { detail: ProjectDetail }) {
  const { t } = useI18n();
  const c = detail.project.conclusion_record;
  return (
    <>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("research.answer.title")}</h3>
        {"summary" in c && c.summary ? (
          <>
            <div className={styles.tags}>
              <span
                className={styles.tag}
                data-tone={c.status === "refuted" ? "warn" : "good"}
              >
                {t(`research.end.${c.status}` as MessageKey)}
              </span>
              <span className={styles.tag}>
                {c.accepted === true
                  ? t("research.answer.accepted")
                  : c.accepted === false
                    ? t("research.answer.sentBack")
                    : t("research.answer.pending")}
              </span>
            </div>
            <Prose text={c.summary} />
            {c.note && (
              <p className={styles.empty}>
                {t("research.answer.note", { text: c.note })}
              </p>
            )}
          </>
        ) : (
          <p className={styles.empty}>{t("research.answer.none")}</p>
        )}
      </section>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("research.answer.report")}</h3>
        <div className={styles.tags}>
          <Button
            size="sm"
            variant="secondary"
            icon={Download}
            onClick={() => window.open(reportUrl(detail.project.id, "zh"))}
          >
            {t("research.answer.reportZh")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={Download}
            onClick={() => window.open(reportUrl(detail.project.id, "en"))}
          >
            {t("research.answer.reportEn")}
          </Button>
        </div>
      </section>
    </>
  );
}

function SceneTab({
  detail,
  events,
  actions,
}: {
  detail: ProjectDetail;
  events: ResearchEvent[];
  actions: ThreadActions;
}) {
  const turns = useMemo(
    () =>
      buildConversation(events, [...detail.sprints].reverse(), detail.nodes),
    [events, detail],
  );
  return (
    <ResearchScene
      turns={turns}
      nodes={detail.nodes}
      live={detail.project.status === "active"}
      onLog={actions.openLog}
    />
  );
}

/** A long fact: three lines, the rest on a click. */
function Long({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <dd
      className={open ? undefined : styles.clamp}
      title={open ? undefined : text}
      onClick={() => setOpen(!open)}
    >
      {text}
    </dd>
  );
}

function MainNumber({ metrics }: { metrics: Record<string, unknown> }) {
  const main = mainMetric(metrics);
  if (!main) return null;
  return (
    <span className={styles.runMain}>
      <span>{main[0]}</span>
      <strong>{main[1].toPrecision(4)}</strong>
    </span>
  );
}
